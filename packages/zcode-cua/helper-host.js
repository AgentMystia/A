import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { callBrokerMethod, CuaHelperError, probeHelperHealth } from "./broker.js";
import { attachCuaHelperStart } from "./helper-host-start.js";
import { attachCuaHelperTermination } from "./helper-host-termination.js";
import { readHelperScreenRecordingPreflightViaLaunchServices } from "./helper-launch.js";
import { injectPermissionBrokerConfig } from "./helper-mcp-server.js";
import { createDefaultHelperPidEvidenceProvider } from "./helper-process-evidence.js";

const SCREEN_RECORDING_PREFLIGHT_DIR = ".screen-recording-preflight";

function mintRandomSecret() {
  return randomBytes(32).toString("hex");
}

export class CuaHelperHost {
  handle = null;
  resolverPluginAuthority;
  pluginAuthorityMintError = null;
  startInFlight = null;
  pendingTermination = null;
  terminationInFlight = null;
  pendingFailedLaunch = null;
  failedLaunchCleanupInFlight = null;
  restartAfterCurrentStartInFlight = null;
  restartPreservingTransportInFlight = null;
  pendingRefreshMarker = null;
  reservation = null;
  pendingReservedTuple = null;
  stopGeneration = 0;

  constructor(options) {
    this.options = options;
    this.collectHelperPidEvidence =
      options.collectHelperPidEvidence ??
      createDefaultHelperPidEvidenceProvider({ env: options.env, logger: options.logger });
  }

  get running() {
    return this.handle !== null;
  }

  get socketPath() {
    return this.handle?.socketPath ?? null;
  }

  get pluginAuthority() {
    return this.resolverPluginAuthority ?? null;
  }

  get reservedTransport() {
    return this.handle || !this.reservation?.holdsPublishedPath
      ? null
      : (this.pendingReservedTuple ?? null);
  }

  resolveResolverPluginAuthority() {
    if (this.resolverPluginAuthority !== undefined) return this.resolverPluginAuthority;
    if (this.pluginAuthorityMintError) throw this.pluginAuthorityMintError;
    try {
      this.resolverPluginAuthority = (this.options.mintPluginAuthority ?? mintRandomSecret)();
      return this.resolverPluginAuthority;
    } catch (error) {
      this.pluginAuthorityMintError = new CuaHelperError(
        "launch_failed",
        `Failed to mint ZCode Computer Use resolver plugin authority: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
      throw this.pluginAuthorityMintError;
    }
  }

  async start() {
    if (this.restartPreservingTransportInFlight) {
      return this.restartPreservingTransportInFlight.then((result) => result.handle);
    }
    if (this.restartAfterCurrentStartInFlight) return this.restartAfterCurrentStartInFlight;
    if (this.startInFlight) return this.startInFlight;
    if (this.handle) {
      const generation = this.stopGeneration;
      const retried = await this.retryCompletedRefreshMarkerForLiveHandle();
      this.assertNotExternallyStopped(generation);
      const handle = retried?.handle ?? this.handle;
      if (!handle) {
        throw new CuaHelperError(
          "launch_failed",
          "ZCode Computer Use handle became unavailable during start()",
        );
      }
      return handle;
    }
    const generation = this.stopGeneration;
    await this.finishPendingTermination("before start");
    await this.finishPendingFailedLaunch("before start");
    this.assertNotExternallyStopped(generation);
    if (this.handle) return this.handle;
    if (this.startInFlight) return this.startInFlight;
    const pending = this.doStart(generation, undefined, "cold-start").finally(async () => {
      if (this.startInFlight === pending) this.startInFlight = null;
      await this.releaseReservationIfUnpublished();
    });
    this.startInFlight = pending;
    return pending;
  }

  injectInto(server) {
    if (!this.handle) {
      throw new Error("CuaHelperHost.injectInto called before start(); start the helper first");
    }
    return injectPermissionBrokerConfig(server, { socketPath: this.handle.socketPath });
  }

  async stop() {
    const generation = ++this.stopGeneration;
    const pending = this.startInFlight;
    if (pending) {
      try {
        await pending;
      } catch {
        // stop 仍要收掉已经留下的 handle。
      }
    }
    if (generation === this.stopGeneration) {
      await this.stopCurrentHandle("stop", { allowSigkill: true }, true);
      await this.completeRefreshMarkerAfterTransportRetired();
    }
  }

  async stopCurrentHandle(reason, policy, force = false) {
    const handle = this.handle;
    if (handle?.pid == null && handle) {
      throw new CuaHelperError(
        "termination_failed",
        `Cannot terminate ZCode Computer Use (${reason}): live pid is unknown`,
      );
    }
    this.handle = null;
    if (handle?.pid != null) {
      await this.terminateHelperPid(
        handle.pid,
        reason,
        { socketPath: handle.launchSocketPath, helperAppPath: handle.helperAppPath },
        policy,
        force,
      );
      await this.finishPendingFailedLaunch(reason);
      await this.releasePublishedReservation();
      return;
    }
    await this.finishPendingTermination(reason, policy, force);
    await this.finishPendingFailedLaunch(reason);
    await this.releasePublishedReservation();
  }

  async releaseReservationIfUnpublished() {
    const reservation = this.reservation;
    if (!reservation?.holdsPublishedPath) return;
    await reservation.release().catch(() => {});
    if (this.reservation === reservation) {
      this.reservation = null;
      this.pendingReservedTuple = null;
    }
  }

  async releasePublishedReservation() {
    const reservation = this.reservation;
    if (!reservation) return;
    await reservation.unlinkPublishedIfOwned().catch(() => {});
    if (this.reservation === reservation) {
      this.reservation = null;
      this.pendingReservedTuple = null;
    }
  }

  assertNotExternallyStopped(generation) {
    if (this.stopGeneration !== generation) {
      throw new CuaHelperError("launch_failed", "ZCode Computer Use restart aborted by stop()");
    }
  }

  beginFreshRestart(generation) {
    const pending = (async () => {
      this.assertNotExternallyStopped(generation);
      await this.stopCurrentHandle("restart");
      await this.completeRefreshMarkerAfterTransportRetired();
      this.assertNotExternallyStopped(generation);
      return this.doStart(generation, undefined, "restart");
    })().finally(() => {
      if (this.startInFlight === pending) this.startInFlight = null;
    });
    this.startInFlight = pending;
    return pending;
  }

  async restart() {
    return this.startInFlight ? this.startInFlight : this.beginFreshRestart(this.stopGeneration);
  }

  async restartAfterCurrentStart() {
    if (this.restartAfterCurrentStartInFlight) return this.restartAfterCurrentStartInFlight;
    const generation = this.stopGeneration;
    const pending = (async () => {
      for (;;) {
        this.assertNotExternallyStopped(generation);
        const current = this.startInFlight;
        if (!current) break;
        try {
          await current;
        } catch {
          // 等当前启动结束再重新拉起。
        }
      }
      const restarted = await this.beginFreshRestart(generation);
      this.assertNotExternallyStopped(generation);
      return restarted;
    })().finally(() => {
      if (this.restartAfterCurrentStartInFlight === pending)
        this.restartAfterCurrentStartInFlight = null;
    });
    this.restartAfterCurrentStartInFlight = pending;
    return pending;
  }

  async restartAfterCurrentStartPreservingTransport(options = {}) {
    if (this.restartPreservingTransportInFlight) return this.restartPreservingTransportInFlight;
    const generation = this.stopGeneration;
    const pending = (async () => {
      for (;;) {
        this.assertNotExternallyStopped(generation);
        const current = this.startInFlight;
        if (!current) break;
        try {
          await current;
        } catch {
          // 保留传输的重启要等当前启动先结束。
        }
      }
      this.assertNotExternallyStopped(generation);
      const retried = await this.retryCompletedRefreshMarkerForLiveHandle();
      if (retried) return retried;
      const handle = this.handle;
      if (!handle) {
        options.beforeFreshStart?.();
        const restarted = await this.beginFreshRestart(generation);
        this.assertNotExternallyStopped(generation);
        return { handle: restarted, reused: false };
      }
      return this.beginTransportPreservingRestart(generation, handle);
    })().finally(() => {
      if (this.restartPreservingTransportInFlight === pending)
        this.restartPreservingTransportInFlight = null;
    });
    this.restartPreservingTransportInFlight = pending;
    return pending;
  }

  async checkHealth(timeoutMs = 1_000) {
    if (!this.handle)
      throw new Error("CuaHelperHost.checkHealth called before start(); start the helper first");
    return (
      this.options.healthProbe ??
      ((path, timeout) => probeHelperHealth(path, { timeoutMs: timeout }))
    )(this.handle.socketPath, timeoutMs);
  }

  async queryPermissionStatus(timeoutMs = 3_000) {
    if (!this.handle) {
      throw new Error(
        "CuaHelperHost.queryPermissionStatus called before start(); start the helper first",
      );
    }
    return (
      this.options.permissionStatusProbe ??
      ((path, timeout) =>
        callBrokerMethod({ socketPath: path, method: "permission_status", timeoutMs: timeout }))
    )(this.handle.socketPath, timeoutMs);
  }

  async queryScreenRecordingPreflight(timeoutMs) {
    if (!this.handle) return null;
    const readPreflight =
      this.options.screenRecordingPreflight ?? readHelperScreenRecordingPreflightViaLaunchServices;
    const resultFilePath = join(
      dirname(this.handle.socketPath),
      SCREEN_RECORDING_PREFLIGHT_DIR,
      `.screen-recording-preflight-${randomUUID()}.json`,
    );
    try {
      await mkdir(dirname(resultFilePath), { recursive: true, mode: 0o700 });
    } catch {
      return null;
    }
    return readPreflight({
      appPath: this.handle.helperAppPath,
      resultFilePath,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
  }

  async queryScreenCaptureProbe(timeoutMs = 6500) {
    if (!this.handle) {
      throw new Error(
        "CuaHelperHost.queryScreenCaptureProbe called before start(); start the helper first",
      );
    }
    return (
      this.options.screenCaptureProbe ??
      ((path, timeout) =>
        callBrokerMethod({ socketPath: path, method: "screen_capture_probe", timeoutMs: timeout }))
    )(this.handle.socketPath, timeoutMs);
  }
}

attachCuaHelperTermination(CuaHelperHost);
attachCuaHelperStart(CuaHelperHost);

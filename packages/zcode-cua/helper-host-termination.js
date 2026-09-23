import { CuaHelperError } from "./broker.js";
import {
  HELPER_OPEN_TIMEOUT_MS,
  publishCuaHelperBrokerLaunchCancellation,
  scheduleCuaHelperBrokerLaunchGuardCleanup,
  defaultKillProcess,
  defaultTerminationDelay,
} from "./helper-launch.js";
import { discoverCuaHelperLaunchProcesses } from "./helper-live-identity.js";
import { publishCuaBrokerRefreshMarker } from "./helper-refresh-marker.js";
import { PERMISSION_REFRESH_TERM_GRACE_MS } from "./helper-reservation.js";

const PERMISSION_REFRESH_MARKER_SLACK_MS = 5_000;

export function attachCuaHelperTermination(CuaHelperHost) {
  const prototype = CuaHelperHost.prototype;

  prototype.finishPendingTermination = async function finishPendingTermination(
    reason,
    policy,
    force = false,
  ) {
    const pending = this.pendingTermination;
    if (pending) {
      await this.terminateHelperPid(
        pending.pid,
        reason,
        { socketPath: pending.socketPath, helperAppPath: pending.helperAppPath },
        policy ?? pending.policy,
        force,
      );
      return;
    }
    await this.terminationInFlight;
  };

  prototype.recordAndCleanupFailedLaunch = async function recordAndCleanupFailedLaunch(
    target,
    error,
    observedPid = null,
  ) {
    const pending = this.pendingFailedLaunch;
    if (
      pending &&
      (pending.socketPath !== target.socketPath || pending.helperAppPath !== target.helperAppPath)
    ) {
      throw new CuaHelperError(
        "termination_failed",
        "A previous failed ZCode Computer Use launch is still unresolved; refusing to replace its lifecycle blocker",
        { cause: error },
      );
    }
    this.pendingFailedLaunch ??= {
      ...target,
      context: `startup failed: ${error instanceof Error ? error.message : String(error)}`,
      cancellationPublished: false,
    };
    this.ensureFailedLaunchRevoked(this.pendingFailedLaunch);
    try {
      if (observedPid != null) {
        await this.terminateHelperPid(
          observedPid,
          "live process identity verification failed",
          target,
        );
      }
      await this.finishPendingFailedLaunch("startup failure");
    } catch (cleanupError) {
      throw new CuaHelperError(
        "termination_failed",
        `ZCode Computer Use startup failed and the launched process could not be conclusively cleaned up: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        { cause: error },
      );
    }
  };

  prototype.finishPendingFailedLaunch = async function finishPendingFailedLaunch(reason) {
    if (!this.pendingFailedLaunch) {
      await this.failedLaunchCleanupInFlight;
      return;
    }
    if (this.failedLaunchCleanupInFlight) {
      await this.failedLaunchCleanupInFlight;
      if (this.pendingFailedLaunch) await this.finishPendingFailedLaunch(reason);
      return;
    }
    const pending = this.pendingFailedLaunch;
    this.ensureFailedLaunchRevoked(pending);
    const cleanup = this.runFailedLaunchCleanup(pending, reason)
      .then(() => {
        if (this.pendingFailedLaunch === pending) this.pendingFailedLaunch = null;
      })
      .finally(() => {
        if (this.failedLaunchCleanupInFlight === cleanup) this.failedLaunchCleanupInFlight = null;
      });
    this.failedLaunchCleanupInFlight = cleanup;
    await cleanup;
  };

  prototype.runFailedLaunchCleanup = async function runFailedLaunchCleanup(pending, reason) {
    const discover =
      this.options.discoverLaunchedHelperProcesses ?? discoverCuaHelperLaunchProcesses;
    const pollMs = Math.max(1, this.options.failedLaunchCleanupPollIntervalMs ?? 100);
    const quietPolls = Math.max(
      1,
      Math.ceil(Math.max(0, this.options.failedLaunchCleanupQuietMs ?? 500) / pollMs),
    );
    const delay = this.options.failedLaunchCleanupDelay ?? defaultTerminationDelay;
    const now = this.options.failedLaunchCleanupNow ?? Date.now;
    let quiet = 0;
    const deadlinePolls = pending.cancellationPublished
      ? 0
      : Math.ceil(Math.max(0, pending.guard.deadlineEpochMs - now()) / pollMs);
    const maxIterations = Math.max(32, quietPolls + 8, deadlinePolls + quietPolls + 8);
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const discovered = await discover({
        socketPath: pending.socketPath,
        helperAppPath: pending.helperAppPath,
      });
      if (discovered.state === "unknown") {
        throw new CuaHelperError(
          "termination_failed",
          `Cannot confirm failed ZCode Computer Use launch cleanup (${reason}): ${discovered.detail ?? "process identity is unknown"}`,
        );
      }
      if (discovered.state === "observed") {
        quiet = 0;
        const pids = [...new Set(discovered.pids)].filter(
          (pid) => Number.isInteger(pid) && pid > 1,
        );
        if (pids.length === 0) {
          throw new CuaHelperError(
            "termination_failed",
            `Failed ZCode Computer Use launch discovery returned observed without a valid pid (${reason})`,
          );
        }
        for (const pid of pids) {
          await this.terminateHelperPid(pid, pending.context, {
            socketPath: pending.socketPath,
            helperAppPath: pending.helperAppPath,
          });
        }
      } else {
        quiet += 1;
        const revoked = pending.cancellationPublished || now() >= pending.guard.deadlineEpochMs;
        if (quiet >= quietPolls && revoked) return;
      }
      await delay(pollMs);
    }
    throw new CuaHelperError(
      "termination_failed",
      `Failed ZCode Computer Use launch did not reach a safely revoked quiet state (${reason})${pending.cancellationPublishError ? `; cancel sentinel: ${pending.cancellationPublishError}` : ""}`,
    );
  };

  prototype.ensureFailedLaunchRevoked = function ensureFailedLaunchRevoked(pending) {
    if (pending.cancellationPublished) return;
    try {
      (this.options.publishBrokerLaunchCancellation ?? publishCuaHelperBrokerLaunchCancellation)(
        pending.socketPath,
        pending.guard,
      );
      pending.cancellationPublished = true;
      pending.cancellationPublishError = undefined;
      try {
        (
          this.options.scheduleBrokerLaunchGuardCleanup ?? scheduleCuaHelperBrokerLaunchGuardCleanup
        )(pending.guard);
      } catch (error) {
        this.options.logger?.warn(
          undefined,
          `failed to schedule cua helper launch-cancel cleanup: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } catch (error) {
      pending.cancellationPublishError = error instanceof Error ? error.message : String(error);
    }
  };

  prototype.terminateHelperPid = async function terminateHelperPid(
    pid,
    reason,
    context = {},
    policy = {},
    force = false,
  ) {
    if (pid == null) return;
    if (this.pendingTermination && this.pendingTermination.pid !== pid) {
      throw new CuaHelperError(
        "termination_failed",
        `Cannot terminate ZCode Computer Use pid ${pid} (${reason}): pid ${this.pendingTermination.pid} is still pending termination`,
      );
    }
    const resolvedPolicy =
      !force && this.pendingTermination
        ? this.pendingTermination.policy
        : {
            allowSigkill: policy.allowSigkill ?? true,
            termGraceMs: policy.termGraceMs ?? this.options.terminationTermGraceMs ?? 1_000,
          };
    this.pendingTermination ??= { pid, context: reason, ...context, policy: resolvedPolicy };
    if (this.terminationInFlight) {
      await this.terminationInFlight;
      if (this.pendingTermination?.pid === pid) {
        await this.terminateHelperPid(pid, reason, context, resolvedPolicy, force);
      }
      return;
    }
    const sequence = this.runTerminationSequence(pid, reason, context, resolvedPolicy)
      .catch((error) => {
        throw error instanceof CuaHelperError
          ? error
          : new CuaHelperError(
              "termination_failed",
              `Failed to confirm ZCode Computer Use pid ${pid} termination (${reason}): ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
      })
      .then(() => {
        if (this.pendingTermination?.pid === pid) this.pendingTermination = null;
      })
      .finally(() => {
        if (this.terminationInFlight === sequence) this.terminationInFlight = null;
      });
    this.terminationInFlight = sequence;
    await sequence;
  };

  prototype.runTerminationSequence = async function runTerminationSequence(
    pid,
    reason,
    context,
    policy,
  ) {
    if (
      this.signalHelperIfStillOwned(pid, "SIGTERM", reason, context) &&
      !(await this.waitForHelperDeparture(pid, policy.termGraceMs, reason, context))
    ) {
      if (!policy.allowSigkill) {
        throw new CuaHelperError(
          "termination_failed",
          `ZCode Computer Use pid ${pid} remained alive after SIGTERM (${reason}); SIGKILL is disabled for permission refresh`,
        );
      }
      if (
        this.signalHelperIfStillOwned(pid, "SIGKILL", reason, context) &&
        !(await this.waitForHelperDeparture(
          pid,
          this.options.terminationKillGraceMs ?? 1_000,
          reason,
          context,
        ))
      ) {
        throw new CuaHelperError(
          "termination_failed",
          `ZCode Computer Use pid ${pid} remained alive after SIGTERM and SIGKILL (${reason})`,
        );
      }
    }
  };

  prototype.signalHelperIfStillOwned = function signalHelperIfStillOwned(
    pid,
    signal,
    reason,
    context,
  ) {
    const evidence = this.readHelperPidEvidence(pid, context);
    if (evidence.state === "unknown") {
      throw new CuaHelperError(
        "termination_failed",
        `Cannot safely signal ZCode Computer Use pid ${pid} (${reason}): ${evidence.reason ?? "process identity is unknown"}`,
      );
    }
    if (evidence.state !== "helper") {
      if (evidence.state === "unrelated") {
        const command = evidence.command ? ` (now: ${evidence.command})` : "";
        this.options.logger?.warn(
          undefined,
          `skipping ${signal} of cua helper pid ${pid} (${reason}): ${evidence.reason ?? "pid no longer looks like our Helper"}${command}`,
        );
      }
      return false;
    }
    try {
      (this.options.killProcess ?? defaultKillProcess)(pid, signal);
    } catch (error) {
      this.options.logger?.warn(
        undefined,
        `failed to send ${signal} to cua helper pid ${pid} (${reason}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return true;
  };

  prototype.waitForHelperDeparture = async function waitForHelperDeparture(
    pid,
    graceMs,
    reason,
    context,
  ) {
    const pollMs = Math.max(1, this.options.terminationPollIntervalMs ?? 100);
    const polls = Math.max(1, Math.ceil(Math.max(0, graceMs) / pollMs));
    const delay = this.options.terminationDelay ?? defaultTerminationDelay;
    for (let iteration = 0; iteration < polls; iteration += 1) {
      await delay(pollMs);
      const evidence = this.readHelperPidEvidence(pid, context);
      if (evidence.state === "unknown") {
        throw new CuaHelperError(
          "termination_failed",
          `Cannot confirm ZCode Computer Use pid ${pid} departure (${reason}): ${evidence.reason ?? "process identity is unknown"}`,
        );
      }
      if (evidence.state !== "helper") return true;
    }
    return false;
  };

  prototype.readHelperPidEvidence = function readHelperPidEvidence(pid, context) {
    try {
      return this.collectHelperPidEvidence(pid, context);
    } catch (error) {
      return { state: "unknown", reason: error instanceof Error ? error.message : String(error) };
    }
  };

  prototype.completeRefreshMarkerAfterTransportRetired =
    async function completeRefreshMarkerAfterTransportRetired() {
      const marker = this.pendingRefreshMarker;
      if (!marker) return;
      marker.oldTransportRetired = true;
      await marker.handle.complete();
      if (this.pendingRefreshMarker === marker) this.pendingRefreshMarker = null;
    };

  prototype.retryCompletedRefreshMarkerForLiveHandle =
    async function retryCompletedRefreshMarkerForLiveHandle() {
      const marker = this.pendingRefreshMarker;
      const handle = this.handle;
      if (!marker || !marker.oldTransportRetired || !handle) return null;
      if (handle.socketPath !== marker.socketPath) {
        throw new CuaHelperError(
          "termination_failed",
          "Cannot complete CUA permission refresh marker: live Helper transport no longer matches the pending marker",
        );
      }
      await marker.handle.complete();
      if (this.pendingRefreshMarker === marker) this.pendingRefreshMarker = null;
      return { handle, reused: true };
    };

  prototype.beginTransportPreservingRestart = function beginTransportPreservingRestart(
    generation,
    handle,
  ) {
    const pending = (async () => {
      this.assertNotExternallyStopped(generation);
      if (handle.pid == null) {
        throw new CuaHelperError(
          "termination_failed",
          "Cannot refresh ZCode Computer Use permissions: verified live pid is unavailable",
        );
      }
      const existing = this.pendingRefreshMarker;
      if (existing && existing.socketPath !== handle.socketPath) {
        throw new CuaHelperError(
          "termination_failed",
          "Cannot replace a pending CUA permission refresh marker with a different transport",
        );
      }
      const markerHandle =
        existing?.handle ??
        (await publishCuaBrokerRefreshMarker(handle.socketPath, {
          deadlineMs:
            (this.options.terminationTermGraceMs ?? PERMISSION_REFRESH_TERM_GRACE_MS) +
            HELPER_OPEN_TIMEOUT_MS +
            (this.options.healthTimeoutMs ?? 5_000) +
            PERMISSION_REFRESH_MARKER_SLACK_MS,
        }));
      const marker = existing ?? {
        socketPath: handle.socketPath,
        handle: markerHandle,
        oldTransportRetired: false,
      };
      this.pendingRefreshMarker = marker;
      this.assertNotExternallyStopped(generation);
      await this.stopCurrentHandle("permission refresh", {
        allowSigkill: false,
        termGraceMs: this.options.terminationTermGraceMs ?? PERMISSION_REFRESH_TERM_GRACE_MS,
      });
      marker.oldTransportRetired = true;
      this.assertNotExternallyStopped(generation);
      const restarted = await this.doStart(
        generation,
        { helperAppPath: handle.helperAppPath, socketPath: handle.socketPath },
        "restart",
      );
      await markerHandle.complete();
      if (this.pendingRefreshMarker === marker) this.pendingRefreshMarker = null;
      this.assertNotExternallyStopped(generation);
      return restarted;
    })().finally(() => {
      if (this.startInFlight === pending) this.startInFlight = null;
    });
    this.startInFlight = pending;
    return pending.then((restarted) => ({ handle: restarted, reused: true }));
  };
}

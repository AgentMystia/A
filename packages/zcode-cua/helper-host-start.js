import { CuaHelperError, mintBrokerSocketPath, probeHelperHealth } from "./broker.js";
import { HELPER_BUNDLE_ID } from "./broker-helper-constants.js";
import {
  assertCuaHelperBundleAttestationUnchanged,
  captureCuaHelperBundleAttestation,
} from "./helper-bundle-attest.js";
import { isDevBrokerExposureEnabled, writeDevBrokerCredentialsFile } from "./helper-dev-broker.js";
import {
  isCuaLocalDevelopmentRuntime,
  isUnsignedHelperLocalDevRequested,
  PACKAGED_CUA_HELPER_VERSION,
  resolveCuaHelperInstallVariant,
} from "./helper-install-plan.js";
import {
  cleanupCuaHelperBrokerLaunchGuard,
  cpsActivationDisableRequested,
  prepareCuaHelperBrokerLaunchGuard,
} from "./helper-launch.js";
import {
  CuaHelperLiveProcessIdentityError,
  verifyCuaHelperLiveProcessIdentity,
} from "./helper-live-identity.js";
import { resolveHelperAppPath } from "./helper-process-evidence.js";
import { createTransportReservation } from "./helper-reservation.js";

export function attachCuaHelperStart(CuaHelperHost) {
  CuaHelperHost.prototype.doStart = async function doStart(generation, reuse, reason = "restart") {
    const socketPath =
      reuse?.socketPath ??
      (this.options.mintSocketPath ?? (() => mintBrokerSocketPath({ env: this.options.env })))();
    const pluginAuthority = this.resolveResolverPluginAuthority();
    const reservation =
      reason === "cold-start" && !reuse
        ? await (this.options.createTransportReservation ?? createTransportReservation)({
            socketPath,
            logger: this.options.logger,
          })
        : null;
    this.reservation = reservation;
    this.pendingReservedTuple = reservation ? { socketPath, pluginAuthority } : null;
    const launchSocketPath = reservation?.pendingSocketPath ?? socketPath;
    const installed = reuse ? undefined : await this.options.helperInstaller?.ensureInstalled();
    const candidates = reuse
      ? [reuse.helperAppPath]
      : [...(installed ? [installed] : []), ...this.options.helperAppCandidates];
    const appPath = reuse?.helperAppPath ?? resolveHelperAppPath(candidates);
    if (!appPath) {
      throw new CuaHelperError(
        "helper_missing",
        `ZCode Computer Use is not ready (${candidates.length} internal candidate(s) checked). Restart ZCode or reinstall the Computer Use component.`,
      );
    }
    const attestation = this.options.helperInstaller
      ? captureCuaHelperBundleAttestation(appPath)
      : null;
    const justInstalled = installed !== undefined && appPath === installed;
    await this.options.helperInstaller?.verifyInstalled(appPath, {
      skipGatekeeperAssessment: justInstalled,
    });
    if (attestation) assertCuaHelperBundleAttestationUnchanged(appPath, attestation);
    const ghostCursorOverlay = this.options.ghostCursorOverlay === true;
    const pipMode = this.options.pipMode === true;
    const pipLiveProbe = this.options.pipLiveProbe === true;
    const controllerVariant = resolveCuaHelperInstallVariant(this.options.env ?? process.env);
    const healthTimeoutMs = this.options.healthTimeoutMs ?? 5_000;
    const now = this.options.failedLaunchCleanupNow ?? Date.now;
    const deadlineSlackMs = Math.max(0, this.options.brokerLaunchDeadlineSlackMs ?? 5_000);
    const guard = await (
      this.options.prepareBrokerLaunchGuard ?? prepareCuaHelperBrokerLaunchGuard
    )({
      socketPath: launchSocketPath,
      deadlineEpochMs: now() + healthTimeoutMs + deadlineSlackMs,
      now: now(),
    });
    try {
      await this.options.launcher.launch({
        appPath,
        expectedAppBundlePath: appPath,
        ...(controllerVariant ? { controllerVariant } : {}),
        ...(cpsActivationDisableRequested() ? { disableCpsActivation: true } : {}),
        socketPath: launchSocketPath,
        brokerLaunchGuard: guard,
        ...(attestation
          ? {
              assertHelperUnchangedBeforeLaunch() {
                assertCuaHelperBundleAttestationUnchanged(appPath, attestation);
              },
            }
          : {}),
        env: this.options.env,
        allowUnsignedLauncherLocalDev: isUnsignedHelperLocalDevRequested(this.options.env),
        allowExternalBrokerClientLocalDev:
          isUnsignedHelperLocalDevRequested(this.options.env) ||
          isDevBrokerExposureEnabled(this.options.env),
        version: isCuaLocalDevelopmentRuntime(this.options.env)
          ? this.options.env?.ZCODE_VERSION?.trim() || PACKAGED_CUA_HELPER_VERSION
          : PACKAGED_CUA_HELPER_VERSION,
        ghostCursorOverlay,
        pipMode,
        pipLiveProbe,
      });
    } catch (error) {
      const launchError =
        error instanceof CuaHelperError
          ? error
          : new CuaHelperError(
              "launch_failed",
              `Failed to launch ${appPath}: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
      await this.recordAndCleanupFailedLaunch(
        { socketPath: launchSocketPath, helperAppPath: appPath, guard },
        launchError,
      );
      throw launchError;
    }
    let health;
    let pid;
    try {
      health = await (
        this.options.healthProbe ?? ((path, timeoutMs) => probeHelperHealth(path, { timeoutMs }))
      )(launchSocketPath, healthTimeoutMs);
      const expectedBundleId = this.options.expectedBundleId ?? HELPER_BUNDLE_ID;
      pid = (
        await (this.options.verifyLiveProcessIdentity ?? verifyCuaHelperLiveProcessIdentity)({
          socketPath: launchSocketPath,
          reportedPid: health.pid,
          helperAppPath: appPath,
          expectedBundleId,
          allowAdHocLocalDev: isUnsignedHelperLocalDevRequested(this.options.env),
          env: this.options.env,
        })
      ).pid;
      if (expectedBundleId && health.bundleId !== expectedBundleId) {
        await this.terminateHelperPid(pid, "unexpected bundle id", {
          socketPath: launchSocketPath,
          helperAppPath: appPath,
        });
        throw new CuaHelperError(
          "unexpected_bundle_id",
          `ZCode Computer Use reported bundle id ${health.bundleId ?? "<missing>"} (expected ${expectedBundleId}). Refusing to inject broker credentials because TCC ownership is not the signed ZCode Computer Use.`,
        );
      }
      if (this.stopGeneration !== generation) {
        await this.terminateHelperPid(pid, "stopped-during-start", {
          socketPath: launchSocketPath,
          helperAppPath: appPath,
        });
        throw new CuaHelperError("launch_failed", "ZCode Computer Use start aborted by stop()");
      }
      await (this.options.cleanupBrokerLaunchGuard ?? cleanupCuaHelperBrokerLaunchGuard)(guard);
      if (this.stopGeneration !== generation) {
        await this.terminateHelperPid(pid, "stopped-during-launch-guard-cleanup", {
          socketPath: launchSocketPath,
          helperAppPath: appPath,
        });
        throw new CuaHelperError("launch_failed", "ZCode Computer Use start aborted by stop()");
      }
      await this.reservation?.publish();
    } catch (error) {
      const observedPid =
        error instanceof CuaHelperLiveProcessIdentityError ? error.observedSocketOwnerPid : null;
      await this.recordAndCleanupFailedLaunch(
        { socketPath: launchSocketPath, helperAppPath: appPath, guard },
        error,
        observedPid,
      );
      if (error instanceof CuaHelperError || error instanceof CuaHelperLiveProcessIdentityError)
        throw error;
      throw new CuaHelperError(
        "verification_failed",
        `Failed to verify the live ZCode Computer Use process identity: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    this.handle = {
      socketPath,
      launchSocketPath,
      pluginAuthority,
      helperAppPath: appPath,
      bundleId: health.bundleId,
      pid,
    };
    this.pendingReservedTuple = null;
    try {
      await writeDevBrokerCredentialsFile({
        socketPath,
        env: this.options.env,
        logger: this.options.logger,
      });
    } catch (error) {
      this.options.logger?.warn(
        undefined,
        `ZCODE_CUA_DEV_EXPOSE_BROKER: failed to write broker credentials file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.options.logger?.info(undefined, `cua helper ready at ${appPath} pid=${health.pid ?? "?"}`);
    this.options.logger?.debug?.(undefined, `cua helper socket=${socketPath}`);
    return this.handle;
  };
}

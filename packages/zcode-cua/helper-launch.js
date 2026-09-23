import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { chmod, mkdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { CuaHelperError } from "./broker.js";
import { brokerRuntimeDir, isWindowsNamedPipePath } from "./helper-broker-runtime.js";
import { HELPER_TOOLS } from "./helper-tools.js";

const LAUNCH_DEADLINE_FLAG = "--broker-launch-deadline-epoch-ms";
const LAUNCH_CANCEL_FLAG = "--broker-launch-cancel-file";
const LAUNCH_CANCEL_DIR = ".launch-cancel";
const LAUNCH_CANCEL_SENTINEL =
  /^\.broker-launch-cancel-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.sentinel$/u;
const MAX_LAUNCH_GUARD_WINDOW_MS = 300_000;
const LAUNCH_GUARD_CLEANUP_SLACK_MS = 5_000;
export const HELPER_OPEN_TIMEOUT_MS = 10_000;
const LAUNCHER_PID_ENV = "ZCODE_CUA_LAUNCHER_PID";
const HELPER_LAUNCH_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const PREFLIGHT_TIMEOUT_MS = 8_000;
// 纯构造：main 只 re-export 了启动参数函数，不能因此留下整份 open 实现。
const PREFLIGHT_STATES = /* @__PURE__ */ new Set(["granted", "denied", "unknown"]);
const LAUNCH_ENV_KEYS = /* @__PURE__ */ new Set([
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "__CF_USER_TEXT_ENCODING",
  "ZCODE_CUA_PIP_DEBUG",
]);

const UNSIGNED_LAUNCHER_FLAG = "--allow-unsigned-launcher-local-dev";
const EXTERNAL_BROKER_FLAG = "--allow-external-broker-client-local-dev";
const GHOST_CURSOR_OVERLAY_FLAG = "--ghost-cursor-overlay";
const BACKGROUND_MODE_FLAG = "--background-mode";
const PIP_MODE_FLAG = "--pip-mode";
const PIP_LIVE_PROBE_FLAG = "--pip-live-probe";
const GHOST_CURSOR_CAPTURE_FLAG = "--ghost-cursor-capture";
const PERMISSION_PREFLIGHT_FLAG = "--permission-preflight";
const PERMISSION_PREFLIGHT_RESULT_FLAG = "--permission-preflight-result-file";
const CONTROLLER_VARIANT_FLAG = "--controller-variant";
const DISABLE_CPS_FLAG = "--disable-cps-activation";

export class CuaHelperLaunchAttemptError extends CuaHelperError {
  constructor(error) {
    const normalized =
      error instanceof CuaHelperError
        ? error
        : new CuaHelperError(
            "launch_failed",
            error instanceof Error ? error.message : String(error),
            { cause: error },
          );
    super(normalized.code, normalized.message, { cause: error });
    this.name = "CuaHelperLaunchAttemptError";
  }
}

export function cpsActivationDisableRequested(env = process.env) {
  const flag = env.ZCODE_CUA_DISABLE_CPS_ACTIVATION?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "on" || flag === "yes";
}

function guardAnchorDirectory(socketPath) {
  return isWindowsNamedPipePath(socketPath)
    ? brokerRuntimeDir(process.env)
    : dirname(resolve(socketPath));
}

function hasAnchorableSocketPath(socketPath) {
  return isWindowsNamedPipePath(socketPath) || isAbsolute(socketPath);
}

function canonicalGuardDirectoryForSocket(socketPath) {
  if (!hasAnchorableSocketPath(socketPath)) return null;
  try {
    return join(realpathSync(guardAnchorDirectory(socketPath)), LAUNCH_CANCEL_DIR);
  } catch {
    return null;
  }
}

export function isSafeCuaHelperBrokerLaunchGuard(socketPath, guard) {
  if (
    !Number.isSafeInteger(guard.deadlineEpochMs) ||
    guard.deadlineEpochMs <= 0 ||
    !isAbsolute(guard.cancelFilePath) ||
    !LAUNCH_CANCEL_SENTINEL.test(basename(guard.cancelFilePath))
  ) {
    return false;
  }
  const canonical = canonicalGuardDirectoryForSocket(socketPath);
  if (!canonical) return false;
  try {
    return realpathSync(dirname(guard.cancelFilePath)) === canonical;
  } catch {
    return false;
  }
}

export async function prepareCuaHelperBrokerLaunchGuard(options) {
  const now = options.now ?? Date.now();
  if (
    !hasAnchorableSocketPath(options.socketPath) ||
    !Number.isSafeInteger(options.deadlineEpochMs) ||
    options.deadlineEpochMs <= now ||
    options.deadlineEpochMs - now > MAX_LAUNCH_GUARD_WINDOW_MS
  ) {
    throw new CuaHelperError(
      "launch_failed",
      "Refusing to prepare an unsafe Computer Use Helper broker launch guard",
    );
  }
  let anchor;
  try {
    const directory = guardAnchorDirectory(options.socketPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    anchor = await realpath(directory);
  } catch (error) {
    throw new CuaHelperError(
      "launch_failed",
      `Failed to resolve the Computer Use Helper broker runtime directory: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const cancelDirectory = join(anchor, LAUNCH_CANCEL_DIR);
  await mkdir(cancelDirectory, { recursive: true, mode: 0o700 });
  await chmod(cancelDirectory, 0o700);
  if ((await realpath(cancelDirectory)) !== cancelDirectory) {
    throw new CuaHelperError(
      "launch_failed",
      "Refusing to use a redirected Computer Use Helper launch-cancel directory",
    );
  }
  const mintId = options.mintId ?? randomUUID;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = mintId().trim().toLowerCase();
    const guard = {
      cancelFilePath: join(cancelDirectory, `.broker-launch-cancel-${id}.sentinel`),
      deadlineEpochMs: options.deadlineEpochMs,
    };
    if (
      isSafeCuaHelperBrokerLaunchGuard(options.socketPath, guard) &&
      !existsSync(guard.cancelFilePath)
    ) {
      return guard;
    }
  }
  throw new CuaHelperError(
    "launch_failed",
    "Failed to allocate a unique Computer Use Helper broker launch guard",
  );
}

export function publishCuaHelperBrokerLaunchCancellation(socketPath, guard) {
  if (!isSafeCuaHelperBrokerLaunchGuard(socketPath, guard)) {
    throw new CuaHelperError(
      "termination_failed",
      "Refusing to publish an unsafe Computer Use Helper broker launch cancellation sentinel",
    );
  }
  try {
    writeFileSync(guard.cancelFilePath, "canceled\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if (error.code === "EEXIST") return;
    throw error;
  }
}

export async function cleanupCuaHelperBrokerLaunchGuard(guard) {
  await rm(guard.cancelFilePath, { force: true });
}

export function scheduleCuaHelperBrokerLaunchGuardCleanup(guard, options = {}) {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;
  const delay = Math.max(1_000, guard.deadlineEpochMs - now() + LAUNCH_GUARD_CLEANUP_SLACK_MS);
  setTimer(() => {
    cleanupCuaHelperBrokerLaunchGuard(guard).catch(() => {});
  }, delay).unref?.();
}

export function resolveLauncherPid(env = process.env) {
  const raw = env[LAUNCHER_PID_ENV];
  if (typeof raw === "string") {
    const pid = Number.parseInt(raw.trim(), 10);
    if (Number.isInteger(pid) && pid > 1) return pid;
  }
  return process.pid;
}

export function buildHelperOpenArgs(spec, launcherPid) {
  const args = ["-n", "-g", spec.appPath, "--args", "--socket", spec.socketPath];
  const version = spec.version?.trim();
  if (version) args.push("--version", version);
  const expectedApp = spec.expectedAppBundlePath?.trim();
  if (expectedApp) args.push("--expected-app-bundle-path", expectedApp);
  if (spec.controllerVariant) args.push(CONTROLLER_VARIANT_FLAG, spec.controllerVariant);
  if (spec.disableCpsActivation) args.push(DISABLE_CPS_FLAG, "1");
  if (spec.brokerLaunchGuard) {
    if (!isSafeCuaHelperBrokerLaunchGuard(spec.socketPath, spec.brokerLaunchGuard)) {
      throw new CuaHelperError(
        "launch_failed",
        "Refusing to pass an unsafe Computer Use Helper broker launch guard to LaunchServices",
      );
    }
    args.push(
      LAUNCH_DEADLINE_FLAG,
      String(spec.brokerLaunchGuard.deadlineEpochMs),
      LAUNCH_CANCEL_FLAG,
      spec.brokerLaunchGuard.cancelFilePath,
    );
  }
  args.push("--exit-log", spec.exitLogPath?.trim() || `${spec.socketPath}.exit.log`);
  if (typeof launcherPid === "number" && Number.isInteger(launcherPid) && launcherPid > 0) {
    args.push("--launcher-pid", String(launcherPid));
  }
  if (spec.allowUnsignedLauncherLocalDev === true) args.push(UNSIGNED_LAUNCHER_FLAG);
  if (spec.allowExternalBrokerClientLocalDev === true) args.push(EXTERNAL_BROKER_FLAG);
  if (spec.ghostCursorOverlay === true) args.push(GHOST_CURSOR_OVERLAY_FLAG);
  if (spec.backgroundMode === true) args.push(BACKGROUND_MODE_FLAG);
  if (spec.pipMode === true) args.push(PIP_MODE_FLAG);
  if (spec.pipLiveProbe === true) args.push(PIP_LIVE_PROBE_FLAG);
  if (spec.ghostCursorCapture === true) args.push(GHOST_CURSOR_CAPTURE_FLAG);
  return args;
}

export function buildHelperScreenRecordingPreflightOpenArgs(appPath, resultFilePath) {
  return [
    "-W",
    "-n",
    "-g",
    appPath,
    "--args",
    PERMISSION_PREFLIGHT_FLAG,
    "screen_recording",
    PERMISSION_PREFLIGHT_RESULT_FLAG,
    resultFilePath,
  ];
}

export function parseHelperScreenRecordingPreflightResult(text) {
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.permission !== "screen_recording") return null;
  const state = parsed.state;
  return typeof state === "string" && PREFLIGHT_STATES.has(state) ? state : null;
}

function readHelperPreflightResultFile(resultFilePath) {
  try {
    return existsSync(resultFilePath) ? readFileSync(resultFilePath, "utf8") : null;
  } catch {
    return null;
  }
}

function removeHelperPreflightResultFile(resultFilePath) {
  try {
    rmSync(resultFilePath, { force: true });
  } catch {
    // 结果文件已经消失时不影响预检结论。
  }
}

function isAllowedHelperLaunchEnvKey(key) {
  const upper = key.toUpperCase();
  return LAUNCH_ENV_KEYS.has(upper) || upper.startsWith("LC_");
}

export function sanitizeHelperLaunchEnv(env) {
  const source = env ?? process.env;
  const sanitized = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && isAllowedHelperLaunchEnvKey(key)) sanitized[key] = value;
  }
  sanitized.PATH = HELPER_LAUNCH_PATH;
  return sanitized;
}

function isLaunchServicesTimeout(error, message) {
  if (
    /(?:_LSOpenURLsWithCompletionHandler|LaunchServices|AppleEvent).*(?:-1712|timed out)/iu.test(
      message,
    )
  ) {
    return true;
  }
  if (typeof error !== "object" || error === null) return false;
  return error.code === "ETIMEDOUT" || (error.killed === true && error.signal === "SIGKILL");
}

function formatLaunchServicesErrorMessage(appPath, error) {
  const message = error instanceof Error ? error.message : String(error);
  const summary = `Failed to launch ${appPath} via LaunchServices (open): ${message}`;
  if (!isLaunchServicesTimeout(error, message)) return summary;
  return `${summary}
LaunchServices timed out after ${HELPER_OPEN_TIMEOUT_MS}ms while dispatching ZCode Computer Use. This usually means macOS is still verifying the helper, Gatekeeper blocked first launch, the installed bundle still carries a quarantine attribute, or a stale running Helper instance prevented fresh broker arguments from being delivered. Ask the user to open ZCode's CUA readiness panel, reveal the helper, repair the helper install, or fully quit ZCode and retry; diagnostic command: xattr -dr com.apple.quarantine ${JSON.stringify(appPath)}`;
}

export function openHelperApp(spec) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    try {
      spec.assertHelperUnchangedBeforeLaunch?.();
      execFile(
        HELPER_TOOLS.open,
        buildHelperOpenArgs(spec, resolveLauncherPid()),
        {
          env: sanitizeHelperLaunchEnv(spec.env),
          timeout: HELPER_OPEN_TIMEOUT_MS,
          killSignal: "SIGKILL",
        },
        (error) => {
          if (error) {
            rejectLaunch(
              new CuaHelperError(
                "launch_failed",
                formatLaunchServicesErrorMessage(spec.appPath, error),
                {
                  cause: error,
                },
              ),
            );
            return;
          }
          resolveLaunch();
        },
      );
    } catch (error) {
      rejectLaunch(
        new CuaHelperError(
          "launch_failed",
          `Refusing to launch a changed ZCode Computer Use: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
      );
    }
  });
}

const defaultPreflightLaunch = {
  launchOpen(args, env, timeoutMs, callback) {
    execFile(HELPER_TOOLS.open, args, { env, timeout: timeoutMs }, (error) => callback(error));
  },
};

export async function readHelperScreenRecordingPreflightViaLaunchServices(options) {
  const dependencies = options.dependencies ?? defaultPreflightLaunch;
  const readResult = dependencies.readResult ?? readHelperPreflightResultFile;
  const removeResult = dependencies.removeResult ?? removeHelperPreflightResultFile;
  const timeoutMs = options.timeoutMs ?? PREFLIGHT_TIMEOUT_MS;
  try {
    const launchError = await new Promise((done) => {
      dependencies.launchOpen(
        buildHelperScreenRecordingPreflightOpenArgs(options.appPath, options.resultFilePath),
        sanitizeHelperLaunchEnv(undefined),
        timeoutMs,
        done,
      );
    });
    return launchError
      ? null
      : parseHelperScreenRecordingPreflightResult(readResult(options.resultFilePath));
  } finally {
    removeResult(options.resultFilePath);
  }
}

export function createLaunchServicesLauncher() {
  return {
    async launch(spec) {
      try {
        await openHelperApp(spec);
      } catch (error) {
        throw new CuaHelperLaunchAttemptError(error);
      }
    },
  };
}

export function defaultTerminationDelay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export function defaultKillProcess(pid, signal) {
  process.kill(pid, signal);
}

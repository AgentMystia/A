import { basename, execFile, join, realpath } from "./helper-published-launch-bindings.js";

import { CuaHelperError } from "./broker.js";
import { HELPER_DISPLAY_NAME } from "./broker-helper-constants.js";
import { sanitizeHelperLaunchEnv } from "./helper-launch.js";
import { HELPER_TOOLS } from "./helper-tools.js";

// 发布包 main 用 PlistBuddy 读 TCC 权限主体。函数体不能带测试注入参数，
// 否则 minify 后会比发布包多出 dependencies 分支。
function plistValue(appPath, key) {
  return new Promise((resolveValue, rejectValue) => {
    execFile(
      HELPER_TOOLS.plistBuddy,
      ["-c", `Print :${key}`, join(appPath, "Contents", "Info.plist")],
      { encoding: "utf8", env: sanitizeHelperLaunchEnv(undefined), timeout: 2_000 },
      (error, stdout) => {
        if (error) {
          rejectValue(error);
          return;
        }
        resolveValue(stdout.trim());
      },
    );
  });
}

export async function resolveHelperPermissionSubjectIdentity(appPath) {
  const canonicalApp = await realpath(appPath);
  const [bundleId, displayNameRaw, executableName] = await Promise.all([
    plistValue(canonicalApp, "CFBundleIdentifier"),
    plistValue(canonicalApp, "CFBundleDisplayName"),
    plistValue(canonicalApp, "CFBundleExecutable"),
  ]);
  const displayName = displayNameRaw.trim() || basename(canonicalApp, ".app");
  if (!bundleId.trim() || !displayName || !executableName.trim()) {
    throw new CuaHelperError(
      "verification_failed",
      `${HELPER_DISPLAY_NAME} Info.plist is missing its permission identity at ${canonicalApp}`,
    );
  }
  const executablePath = await realpath(
    join(canonicalApp, "Contents", "MacOS", executableName.trim()),
  );
  return {
    appPath: canonicalApp,
    executablePath,
    displayName,
    bundleId: bundleId.trim(),
  };
}

function plistValueWithRunner(appPath, key, runFile) {
  return new Promise((resolveValue, rejectValue) => {
    runFile(
      HELPER_TOOLS.plistBuddy,
      ["-c", `Print :${key}`, join(appPath, "Contents", "Info.plist")],
      { encoding: "utf8", env: sanitizeHelperLaunchEnv(undefined), timeout: 2_000 },
      (error, stdout) => {
        if (error) {
          rejectValue(error);
          return;
        }
        resolveValue(stdout.trim());
      },
    );
  });
}

// 只给同目录测试用。桌面入口不引用，esbuild 会整段删掉，避免 host 留下未使用的 node import。
export async function resolveHelperPermissionSubjectIdentityForTest(appPath, dependencies = {}) {
  const canonicalize = dependencies.realpath ?? realpath;
  const runFile = dependencies.execFile ?? execFile;
  const canonicalApp = await canonicalize(appPath);
  const [bundleId, displayNameRaw, executableName] = await Promise.all([
    plistValueWithRunner(canonicalApp, "CFBundleIdentifier", runFile),
    plistValueWithRunner(canonicalApp, "CFBundleDisplayName", runFile),
    plistValueWithRunner(canonicalApp, "CFBundleExecutable", runFile),
  ]);
  const displayName = displayNameRaw.trim() || basename(canonicalApp, ".app");
  if (!bundleId.trim() || !displayName || !executableName.trim()) {
    throw new CuaHelperError(
      "verification_failed",
      `${HELPER_DISPLAY_NAME} Info.plist is missing its permission identity at ${canonicalApp}`,
    );
  }
  const executablePath = await canonicalize(
    join(canonicalApp, "Contents", "MacOS", executableName.trim()),
  );
  return {
    appPath: canonicalApp,
    executablePath,
    displayName,
    bundleId: bundleId.trim(),
  };
}

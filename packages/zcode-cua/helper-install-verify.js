import { CuaHelperError } from "./broker.js";
import { HELPER_APP_NAME } from "./broker-helper-constants.js";
import { execFileText } from "./helper-exec-file-text.js";
import { readMachoArchNames } from "./helper-macho.js";
import { existsSync, join } from "./helper-published-launch-bindings.js";
import { HELPER_TOOLS } from "./helper-tools.js";

// 发布包把校验函数和启动函数放在同一个没有 node import 的模块里。
// existsSync / join 走 launch bindings，工具路径走 HELPER_TOOLS，文本执行走 helper-exec-file-text.js。
// 这里再写 execFile、existsSync、join 的 node import，压缩后会单独留下一个空 import 模块。

export function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function defaultReadBundleInfo(appPath) {
  const plistPath = join(appPath, "Contents", "Info.plist");
  const { stdout } = await execFileText(HELPER_TOOLS.plist, [
    "-convert",
    "json",
    "-o",
    "-",
    plistPath,
  ]);
  const plist = JSON.parse(stdout);
  return {
    bundleId: readString(plist.CFBundleIdentifier),
    version: readString(plist.CFBundleShortVersionString),
    buildVersion: readString(plist.CFBundleVersion),
    executableName: readString(plist.CFBundleExecutable),
    buildId: readString(plist.ZCodeCUAHelperBuildId),
  };
}

export async function defaultVerifyCodeSignature(appPath) {
  await execFileText(HELPER_TOOLS.codesign, ["--verify", "--deep", "--strict", appPath]);
}

export async function defaultInspectCodesignDetails(appPath) {
  const { stdout, stderr } = await execFileText(HELPER_TOOLS.codesign, [
    "-dv",
    "--verbose=4",
    appPath,
  ]);
  const output = `${stdout}\n${stderr}`;
  const teamIdentifier = output.match(/^TeamIdentifier=(.+)$/mu)?.[1]?.trim() || null;
  const authorities = [...output.matchAll(/^Authority=(.+)$/gmu)]
    .map((match) => match[1]?.trim())
    .filter((authority) => !!authority);
  return {
    teamIdentifier: teamIdentifier === "not set" ? null : teamIdentifier,
    authorities,
    rawOutput: output,
    adHoc: /^Signature=adhoc$/mu.test(output),
  };
}

export async function defaultAssessGatekeeper(appPath) {
  if (existsSync(HELPER_TOOLS.syspolicyCheck)) {
    await execFileText(HELPER_TOOLS.syspolicyCheck, ["distribution", appPath]);
    return;
  }
  await execFileText(HELPER_TOOLS.spctl, ["-a", "-vv", "-t", "exec", appPath]);
}

export async function inspectCodesignDetailsBestEffort(appPath, dependencies) {
  try {
    return await dependencies.inspectCodesignDetails(appPath);
  } catch {
    return null;
  }
}

export function isExpectedHelperVersion(bundleInfo, expectedVersion) {
  return expectedVersion === undefined
    ? true
    : bundleInfo.version === expectedVersion && bundleInfo.buildVersion === expectedVersion;
}

export function describeHelperVersionMismatch(bundleInfo, expectedVersion) {
  const shortVersion = bundleInfo.version ?? "<missing>";
  const buildVersion = bundleInfo.buildVersion ?? "<missing>";
  return `${HELPER_APP_NAME} version mismatch: expected short/build ${expectedVersion}, got short ${shortVersion}, build ${buildVersion}`;
}

export const defaultCuaHelperVerifierDependencies = {
  readBundleInfo: defaultReadBundleInfo,
  readExecutableArchs: readMachoArchNames,
  verifyCodeSignature: defaultVerifyCodeSignature,
  inspectCodesignDetails: defaultInspectCodesignDetails,
  assessGatekeeper: defaultAssessGatekeeper,
};

export async function verifyCuaHelperBundle(appPath, plan, dependencies, options = {}) {
  const bundleInfo = await dependencies.readBundleInfo(appPath);
  if (bundleInfo.bundleId !== plan.expectedBundleId) {
    throw new CuaHelperError(
      "verification_failed",
      `${HELPER_APP_NAME} bundle id ${bundleInfo.bundleId ?? "<missing>"} does not match ${plan.expectedBundleId}`,
    );
  }
  const expectedVersion = plan.source.kind === "bundled" ? undefined : plan.version;
  if (!isExpectedHelperVersion(bundleInfo, expectedVersion)) {
    throw new CuaHelperError(
      "verification_failed",
      describeHelperVersionMismatch(bundleInfo, plan.version),
    );
  }
  if (plan.expectedBuildId && bundleInfo.buildId !== plan.expectedBuildId) {
    throw new CuaHelperError(
      "verification_failed",
      `${HELPER_APP_NAME} build id ${bundleInfo.buildId ?? "<missing>"} does not match ${plan.expectedBuildId}`,
    );
  }
  if (!bundleInfo.executableName) {
    throw new CuaHelperError(
      "verification_failed",
      `${HELPER_APP_NAME} Info.plist is missing CFBundleExecutable`,
    );
  }
  const executablePath = join(appPath, "Contents", "MacOS", bundleInfo.executableName);
  const archs = await dependencies.readExecutableArchs(executablePath);
  if (!archs.includes(plan.arch)) {
    throw new CuaHelperError(
      "verification_failed",
      `${HELPER_APP_NAME} executable archs [${archs.join(", ") || "<none>"}] do not include ${plan.arch}`,
    );
  }
  if (plan.allowUnsignedLocalDev) {
    const codesign = await inspectCodesignDetailsBestEffort(appPath, dependencies);
    return { bundleInfo, codesign, releaseEligible: false, mode: "local_dev_unsigned" };
  }
  await dependencies.verifyCodeSignature(appPath);
  const codesign = await dependencies.inspectCodesignDetails(appPath);
  if (codesign.adHoc || !codesign.teamIdentifier) {
    throw new CuaHelperError(
      "verification_failed",
      `${HELPER_APP_NAME} is not signed with a stable Apple TeamIdentifier`,
    );
  }
  if (!plan.expectedTeamIdentifier) {
    throw new CuaHelperError(
      "verification_failed",
      `${HELPER_APP_NAME} release verification requires a pinned Apple TeamIdentifier; refusing to trust an unpinned signing team as the TCC owner`,
    );
  }
  if (codesign.teamIdentifier !== plan.expectedTeamIdentifier) {
    throw new CuaHelperError(
      "verification_failed",
      `${HELPER_APP_NAME} TeamIdentifier ${codesign.teamIdentifier} does not match ${plan.expectedTeamIdentifier}`,
    );
  }
  if (!options.skipGatekeeperAssessment) await dependencies.assessGatekeeper(appPath);
  return { bundleInfo, codesign, releaseEligible: true, mode: "release" };
}

import { join } from "node:path";

import { CuaHelperError } from "./broker.js";
import {
  DEV_CUA_HELPER_BUNDLE_ID,
  DEV_HELPER_APP_NAME,
  HELPER_APP_NAME,
  HELPER_BUNDLE_ID,
} from "./broker-helper-constants.js";

export const CUA_HELPER_INSTALL_VARIANT_ENV = "ZCODE_CUA_HELPER_INSTALL_VARIANT";
export const CUA_HELPER_INSTALL_VARIANTS = ["stable", "preview", "dev-desktop", "standalone"];
export const PACKAGED_CUA_HELPER_VERSION = "3.14.1";
export const EXPECTED_CUA_HELPER_TEAM_ID = "8A5X4JJ39T";
const DEV_MODE_ENV = "ZCODE_CUA_DEV_MODE";
const INTRANET_DEPS_PORT = 12345;

function readCompiledLocalDevelopmentRuntime() {
  return typeof __ZCODE_LOCAL_DEVELOPMENT_RUNTIME__ === "undefined"
    ? process.env.NODE_ENV !== "production"
    : __ZCODE_LOCAL_DEVELOPMENT_RUNTIME__;
}

function embeddedCuaHelperBuildId() {
  return typeof __ZCODE_CUA_HELPER_BUILD_ID__ === "undefined" ? "" : __ZCODE_CUA_HELPER_BUILD_ID__;
}

export function isCuaDevModeRequested(env = process.env) {
  const flag = env[DEV_MODE_ENV]?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "on";
}

export function isExplicitLocalDevOptIn(value) {
  const flag = value?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "on";
}

export function isCuaLocalDevelopmentRuntime(
  env = process.env,
  compiled = readCompiledLocalDevelopmentRuntime(),
) {
  return Boolean(compiled) && env.ZCODE_RUNTIME_ENV?.trim().toLowerCase() !== "production";
}

export function isDevMode(env = process.env) {
  if (!isCuaLocalDevelopmentRuntime(env)) return false;
  const flag = env.ZCODE_CUA_HELPER_ALLOW_UNSIGNED_LOCAL?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "on" || isCuaDevModeRequested(env);
}

export function isUnsignedHelperLocalDevRequested(env = process.env) {
  return isCuaLocalDevelopmentRuntime(env)
    ? isExplicitLocalDevOptIn(env.ZCODE_CUA_HELPER_ALLOW_UNSIGNED_LOCAL) ||
        isCuaDevModeRequested(env)
    : false;
}

export function resolveZcodeHome(env) {
  return env.ZCODE_HOME?.trim() || (env.HOME?.trim() ? join(env.HOME.trim(), ".zcode") : null);
}

export function resolveHelperAppName(env = process.env) {
  return isDevMode(env) ? DEV_HELPER_APP_NAME : HELPER_APP_NAME;
}

export function resolveCuaHelperInstallVariant(env) {
  const requested = env[CUA_HELPER_INSTALL_VARIANT_ENV]?.trim();
  if (requested && CUA_HELPER_INSTALL_VARIANTS.includes(requested)) return requested;
  if (requested) return null;
  if (isCuaLocalDevelopmentRuntime(env)) return "dev-desktop";
  return env.ZCODE_ENV?.trim().toLowerCase() === "test" ? "preview" : "stable";
}

export function resolveCuaHelperInstallRoot(env) {
  const home = resolveZcodeHome(env);
  if (!home) return null;
  const base = join(home, "computer-use");
  const variant = resolveCuaHelperInstallVariant(env);
  if (!variant) return null;
  if (variant === "dev-desktop" || resolveHelperAppName(env) === DEV_HELPER_APP_NAME) {
    return join(base, "dev");
  }
  return variant === "preview" ? join(base, "preview") : base;
}

export function recognizedCuaHelperInstallRoots(env = process.env) {
  const home = resolveZcodeHome(env);
  if (!home) return [];
  const base = join(home, "computer-use");
  return [
    base,
    join(base, "dev"),
    ...CUA_HELPER_INSTALL_VARIANTS.map((variant) => join(base, variant)),
  ];
}

export function normalizeHelperPlatform(value) {
  switch (value.toLowerCase()) {
    case "mac":
    case "macos":
    case "osx":
    case "darwin":
      return "darwin";
    default:
      return value;
  }
}

export function normalizeHelperArch(value) {
  switch (value.toLowerCase()) {
    case "aarch64":
    case "arm64":
      return "arm64";
    case "amd64":
    case "x86_64":
    case "x64":
      return "x64";
    default:
      throw new CuaHelperError("install_failed", `Unsupported ZCode Computer Use arch: ${value}`);
  }
}

export function normalizeHelperBuildId(value) {
  const buildId = value?.trim();
  if (!buildId) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(buildId)) {
    throw new CuaHelperError(
      "install_failed",
      "ZCODE_CUA_HELPER_BUILD_ID must use 1-128 ASCII letters, digits, dots, underscores, or hyphens",
    );
  }
  return buildId;
}

export function resolveCuaHelperRuntimeVersion(options = {}) {
  const env = options.env ?? process.env;
  const localDevelopment = options.localDevelopmentRuntime ?? isCuaLocalDevelopmentRuntime(env);
  return localDevelopment
    ? options.explicitVersion?.trim() || env.ZCODE_CUA_HELPER_VERSION?.trim() || undefined
    : PACKAGED_CUA_HELPER_VERSION;
}

export function resolveExpectedCuaHelperBuildId(
  env = process.env,
  embedded = embeddedCuaHelperBuildId(),
) {
  const fromEnv = isCuaLocalDevelopmentRuntime(env)
    ? env.ZCODE_CUA_HELPER_BUILD_ID?.trim()
    : undefined;
  return normalizeHelperBuildId(embedded.trim() || fromEnv);
}

export function resolveExpectedCuaHelperBundleId(env = process.env) {
  const localDevelopment = isCuaLocalDevelopmentRuntime(env);
  const override = localDevelopment ? env.ZCODE_CUA_HELPER_BUNDLE_ID?.trim() : undefined;
  return (
    override ||
    (localDevelopment && isUnsignedHelperLocalDevRequested(env)
      ? DEV_CUA_HELPER_BUNDLE_ID
      : HELPER_BUNDLE_ID)
  );
}

// 发布包默认下载根带有内网主机名。那个名字不能进仓库，未配置时只留下调用方自己的主机名。
export function resolveCuaHelperDownloadBaseUrl(version, buildId, env) {
  const explicit = env.ZCODE_CUA_HELPER_DOWNLOAD_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const deps = env.ZCODE_DEPS_BASE_URL?.trim();
  const root = deps
    ? deps.replace(/\/+$/, "")
    : `http://${env.INTRANET_MACHINE_HOST?.trim() || ""}:${INTRANET_DEPS_PORT}/zcode/deps`;
  const base = `${root}/zcode-cua-helper-${version}`;
  return buildId ? `${base}/${buildId}` : base;
}

export function resolveCuaHelperInstallPlan(options = {}) {
  const env = options.env ?? process.env;
  const localDevelopment = isCuaLocalDevelopmentRuntime(env);
  const platform = normalizeHelperPlatform(
    (localDevelopment ? (options.targetPlatform ?? env.ZCODE_TARGET_OS) : undefined) ??
      process.platform,
  );
  if (platform !== "darwin") {
    throw new CuaHelperError(
      "install_failed",
      `ZCode Computer Use auto-install is only supported on macOS, got ${platform}`,
    );
  }
  const arch = normalizeHelperArch(
    (localDevelopment
      ? (options.targetArch ?? env.ZCODE_TARGET_ARCH ?? env.npm_config_arch)
      : undefined) ?? process.arch,
  );
  const version =
    resolveCuaHelperRuntimeVersion({
      env,
      explicitVersion: options.version,
      localDevelopmentRuntime: localDevelopment,
    }) ?? "0.0.0";
  if (!resolveZcodeHome(env)) {
    throw new CuaHelperError(
      "install_failed",
      "Cannot resolve ${ZCODE_HOME:-$HOME/.zcode}; set ZCODE_HOME or HOME before installing ZCode Computer Use.",
    );
  }
  const platformKey = `${platform}-${arch}`;
  const expectedBuildId = resolveExpectedCuaHelperBuildId(
    env,
    options.embeddedBuildId ?? embeddedCuaHelperBuildId(),
  );
  if (!localDevelopment && !expectedBuildId) {
    throw new CuaHelperError(
      "install_failed",
      "Packaged ZCode is missing its embedded Computer Use Helper build identity; refusing an unpinned Helper install",
    );
  }
  const bundledAppPath = options.bundledAppPath?.trim() || null;
  if (!localDevelopment && !bundledAppPath) {
    throw new CuaHelperError(
      "install_failed",
      "Packaged ZCode is missing its bundled ZCode Computer Use.app path",
    );
  }
  const source = bundledAppPath
    ? { kind: "bundled", appPath: bundledAppPath }
    : (() => {
        const fileName = `ZCode-CUA-Helper-${version}-mac-${arch}.zip`;
        return {
          kind: "download",
          fileName,
          url:
            env.ZCODE_CUA_HELPER_DOWNLOAD_URL?.trim() ||
            `${resolveCuaHelperDownloadBaseUrl(version, expectedBuildId, env)}/${fileName}`,
        };
      })();
  const installRoot = resolveCuaHelperInstallRoot(env);
  if (!installRoot) {
    throw new CuaHelperError(
      "install_failed",
      `Cannot resolve a safe Computer Use Helper install root from ${CUA_HELPER_INSTALL_VARIANT_ENV}.`,
    );
  }
  return {
    version,
    platform,
    arch,
    platformKey,
    installRoot,
    appPath: join(installRoot, resolveHelperAppName(env)),
    source,
    expectedBundleId: resolveExpectedCuaHelperBundleId(env),
    expectedTeamIdentifier: localDevelopment
      ? env.ZCODE_CUA_HELPER_TEAM_ID?.trim() || EXPECTED_CUA_HELPER_TEAM_ID
      : EXPECTED_CUA_HELPER_TEAM_ID,
    expectedBuildId,
    allowUnsignedLocalDev: isUnsignedHelperLocalDevRequested(env),
  };
}

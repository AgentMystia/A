/** 发布包 `isWebRemoteControlV4AppVersion` 的门槛。达到 3.4.0 正式版才走 /remote/v4。 */
export const WEB_REMOTE_CONTROL_V4_MIN_VERSION = "3.4.0";

export const DEFAULT_WEB_REMOTE_CONTROL_RELAY_WS_URL = "wss://zcode.z.ai/ws";
export const WEB_REMOTE_CONTROL_TEST_ENDPOINT_ORIGIN = "https://zcode.chatglm.site";
export const WEB_REMOTE_CONTROL_TEST_RELAY_WS_URL = "wss://zcode.chatglm.site/ws";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([^+]+))?(?:\+(.+))?$/;

/**
 * 与发布包一致：缺版本、非 semver、或恰好 3.4.0 的预发布都不是 v4。
 * 数字段已经高于门槛时，预发布后缀不再把结果打回 v3。
 */
export function isWebRemoteControlV4AppVersion(version: string | undefined): boolean {
  if (!version) return false;
  const match = SEMVER.exec(version.trim().replace(/^v/i, ""));
  if (!match) return false;
  const prerelease = match[4]?.split(".");
  const prereleaseOk =
    prerelease === undefined ||
    prerelease.every(
      (part) =>
        /^[0-9A-Za-z-]+$/.test(part) && (!/^\d+$/.test(part) || /^(0|[1-9]\d*)$/.test(part)),
    );
  const build = match[5]?.split(".");
  const buildOk = build === undefined || build.every((part) => /^[0-9A-Za-z-]+$/.test(part));
  if (!prereleaseOk || !buildOk) return false;
  const actual = [Number(match[1]), Number(match[2]), Number(match[3])];
  const minimum = WEB_REMOTE_CONTROL_V4_MIN_VERSION.split(".").map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] !== minimum[index]) return actual[index]! > minimum[index]!;
  }
  return prerelease === undefined;
}

/**
 * 拨号地址不跟随用户 endpoint 的 host。
 * 只有测试域和显式 override 离开生产 relay。
 */
export function resolveWebRemoteControlRelayWsUrl(input?: {
  overrideUrl?: string;
  endpointOrigin?: string;
}): string {
  const override = input?.overrideUrl?.trim();
  if (override) return override;
  if (input?.endpointOrigin?.trim() === WEB_REMOTE_CONTROL_TEST_ENDPOINT_ORIGIN) {
    return WEB_REMOTE_CONTROL_TEST_RELAY_WS_URL;
  }
  return DEFAULT_WEB_REMOTE_CONTROL_RELAY_WS_URL;
}

export function buildWebRemoteControlExternalQrUrl(input: {
  baseUrl: string;
  deviceSid: string;
  passHash: string;
  timestamp: number;
  deviceMid?: string;
  deviceName?: string;
  appVersion?: string;
  // 发布包会把 theme 放进参数解构。查询串不包含它。
  theme?: string;
}): string {
  const {
    baseUrl,
    deviceSid,
    passHash,
    timestamp,
    deviceMid,
    deviceName,
    appVersion,
    theme: _theme,
  } = input;
  void _theme;
  const url = new URL(baseUrl);
  url.searchParams.set("sid", deviceSid);
  url.searchParams.set("hash", passHash);
  url.searchParams.set("t", String(timestamp));
  const trimmedMid = deviceMid?.trim();
  const trimmedName = deviceName?.trim();
  const trimmedAppVersion = appVersion?.trim();
  if (trimmedMid) url.searchParams.set("mid", trimmedMid);
  if (trimmedName) url.searchParams.set("name", trimmedName);
  if (trimmedAppVersion) url.searchParams.set("app_version", trimmedAppVersion);
  return url.toString();
}

import { ZCODE_VERSION, type ZCodeEnv } from "@zcode/shared";

declare const __ZCODE_CDN_BASE_URL__: string | undefined;
declare const __ZCODE_REMOTE_CDN_BASE_URLS__: readonly string[] | undefined;

const DOMESTIC_REMOTE_CDN_BASE_URL = "https://cdn.codegeex.cn/zcode/electron/releases";
const OVERSEAS_REMOTE_CDN_BASE_URL = "https://cdn.zcode-ai.com/zcode/electron/releases";
const PUBLISHED_REMOTE_CDN_RELEASE_ROOT = "https://cdn-zcode.z.ai/zcode/electron/releases";
const REMOTE_CDN_RELEASE_SUFFIX = "/zcode/electron/releases";

export interface ResolveRemoteCdnOptions {
  env?: ZCodeEnv;
  locale?: string;
  timeZone?: string;
  overrideBaseUrl?: string;
  version?: string;
  now?: Date;
}

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function isChineseLocale(locale: string | undefined): boolean {
  return locale?.trim().toLowerCase().startsWith("zh") ?? false;
}

export function resolveLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function resolveTimeZoneOffsetMinutes(timeZone: string, now: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const fields = Object.fromEntries(
      parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
    ) as Record<string, string>;
    const year = Number(fields.year);
    const month = Number(fields.month);
    const day = Number(fields.day);
    const hour = Number(fields.hour);
    const minute = Number(fields.minute);
    const second = Number(fields.second);
    if ([year, month, day, hour, minute, second].some((value) => Number.isNaN(value))) {
      return null;
    }
    const zonedUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    return Math.round((zonedUtc - now.getTime()) / 60_000);
  } catch {
    return null;
  }
}

export function isUtcPlusEightTimeZone(timeZone: string | undefined, now = new Date()): boolean {
  const trimmed = timeZone?.trim();
  return trimmed ? resolveTimeZoneOffsetMinutes(trimmed, now) === 480 : false;
}

export function shouldPreferDomesticRemoteCdn(options: ResolveRemoteCdnOptions = {}): boolean {
  const timeZone = options.timeZone ?? resolveLocalTimeZone();
  return isChineseLocale(options.locale) && isUtcPlusEightTimeZone(timeZone, options.now);
}

function normalizeInjectedRemoteCdnBase(value: string): string {
  const base = normalizeBaseUrl(value.trim());
  if (base.endsWith(REMOTE_CDN_RELEASE_SUFFIX)) return base;
  return `${base}${REMOTE_CDN_RELEASE_SUFFIX}`;
}

function readInjectedRemoteCdnBaseUrls(): readonly string[] {
  const fromProcess = process.env.ZCODE_CDN_BASE_URL?.trim();
  if (fromProcess) return [fromProcess];
  if (
    typeof __ZCODE_REMOTE_CDN_BASE_URLS__ !== "undefined" &&
    __ZCODE_REMOTE_CDN_BASE_URLS__.length > 0
  ) {
    return __ZCODE_REMOTE_CDN_BASE_URLS__;
  }
  const fromDefine =
    typeof __ZCODE_CDN_BASE_URL__ === "undefined" ? "" : __ZCODE_CDN_BASE_URL__.trim();
  return fromDefine ? [fromDefine] : [];
}

export function resolveRemoteCdnBaseUrls(
  options: ResolveRemoteCdnOptions = {},
  injectedBaseUrls: readonly string[] = readInjectedRemoteCdnBaseUrls(),
): string[] {
  const override = options.overrideBaseUrl?.trim();
  if (override) return [normalizeBaseUrl(override)];

  const ordered = shouldPreferDomesticRemoteCdn(options)
    ? [DOMESTIC_REMOTE_CDN_BASE_URL, OVERSEAS_REMOTE_CDN_BASE_URL]
    : [OVERSEAS_REMOTE_CDN_BASE_URL, DOMESTIC_REMOTE_CDN_BASE_URL];
  const version = options.version ?? ZCODE_VERSION;
  // 发布包在 env==="test" 时返回内网资源根。该地址不进入源码；test 与其它环境走注入列表。
  const bases =
    injectedBaseUrls.length > 0
      ? injectedBaseUrls.map((base) => normalizeInjectedRemoteCdnBase(base))
      : ordered;
  return bases.map((base) => `${normalizeBaseUrl(base)}/${version}`);
}

export const publishedRemoteCdnReleaseRoot = PUBLISHED_REMOTE_CDN_RELEASE_ROOT;

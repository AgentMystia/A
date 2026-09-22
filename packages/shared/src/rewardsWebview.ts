import { z } from "zod";
import type { ZCodeEnv } from "./env.js";

/** 发布包奖励 webview 的 session 分区。凭据只写进这个分区，不进普通浏览分区。 */
export const REWARDS_WEBVIEW_PARTITION = "persist:zcode-rewards";
export const REWARDS_CONTEXT_EVENT = "zcode-rewards-context";
export const REWARDS_DEV_ARGUMENT = "--zcode-rewards-dev";
export const REWARDS_WEBVIEW_OVERRIDE_ENV_KEY = "VITE_REWARDS_WEBVIEW_ORIGIN";

export const REWARDS_LOCAL_STORAGE_KEYS = [
  "oauth:zai:access_token",
  "oauth:bigmodel:access_token",
  "zcodejwttoken",
] as const;

const REWARDS_PRODUCTION_ORIGIN = "https://zcode.z.ai";
const REWARDS_TEST_ORIGIN = "https://zcode.chatglm.site";
const REWARDS_DEV_ORIGIN = "http://localhost:3000";
const REWARDS_PATHNAME = /^\/(cn|en)\/rewards\/?$/;

export const rewardsWebviewContextSchema = z.object({
  theme: z.enum(["zai-light", "zai-dark"]),
  locale: z.enum(["zh-CN", "en-US"]),
  auth: z.object({
    status: z.enum(["ready", "anonymous"]),
    provider: z.enum(["zai", "bigmodel"]).nullable(),
    revision: z.number().int().nonnegative(),
  }),
});

export type RewardsWebviewContext = z.infer<typeof rewardsWebviewContextSchema>;
export type RewardsWebviewTheme = RewardsWebviewContext["theme"];
export type RewardsWebviewLocale = RewardsWebviewContext["locale"];

export interface RewardsWebviewTrustOptions {
  dev?: boolean;
  e2e?: boolean;
}

/**
 * 发布包 `isTrustedRewardsUrl`：只放行嵌入奖励页。
 * 用户名或密码会让官网脚本读到不该出现在 URL 里的凭据，直接拒绝。
 */
export function isTrustedRewardsUrl(
  value: string,
  options: RewardsWebviewTrustOptions = {},
): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    const originAllowed =
      url.origin === REWARDS_PRODUCTION_ORIGIN ||
      url.origin === REWARDS_TEST_ORIGIN ||
      (options.dev === true && url.origin === REWARDS_DEV_ORIGIN) ||
      (options.e2e === true &&
        url.protocol === "http:" &&
        (url.hostname === "127.0.0.1" || url.hostname === "localhost"));
    return (
      originAllowed &&
      REWARDS_PATHNAME.test(url.pathname) &&
      url.searchParams.get("embedded") === "app"
    );
  } catch {
    return false;
  }
}

export function buildRewardsWebviewUrl(
  origin: string,
  locale: RewardsWebviewLocale,
  theme: RewardsWebviewTheme,
): string {
  const url = new URL(`/${locale === "zh-CN" ? "cn" : "en"}/rewards`, origin);
  url.searchParams.set("embedded", "app");
  url.searchParams.set("theme", theme);
  return url.toString();
}

/**
 * 发布包先用固定 locale/theme 探测 override，可信才取它的 origin。
 * 探测失败或没有 override 时，测试环境走 chatglm，其余走 zcode.z.ai。
 */
export function resolveRewardsWebviewOrigin(options: {
  env: ZCodeEnv;
  override?: string | null;
  dev?: boolean;
  e2e?: boolean;
}): string {
  const override = options.override?.trim();
  if (override) {
    try {
      const probe = buildRewardsWebviewUrl(override, "en-US", "zai-dark");
      if (isTrustedRewardsUrl(probe, options)) {
        return new URL(override).origin;
      }
    } catch {
      // override 不是合法 base URL 时沿用环境默认 origin。
    }
  }
  return options.env === "test" ? REWARDS_TEST_ORIGIN : REWARDS_PRODUCTION_ORIGIN;
}

export function buildRewardsContextInjectionScript(
  context: RewardsWebviewContext,
  tokens: { oauth?: string | null; jwt?: string | null },
  expectedUrl?: string,
): string {
  const parsed = rewardsWebviewContextSchema.parse(context);
  const entries =
    parsed.auth.status === "ready"
      ? {
          [`oauth:${parsed.auth.provider}:access_token`]: tokens.oauth?.trim() || null,
          zcodejwttoken: tokens.jwt?.trim() || null,
        }
      : {};
  const locationGuard = expectedUrl
    ? `if (window.location.href !== ${JSON.stringify(expectedUrl)}) return;`
    : "";
  return `(() => {
    ${locationGuard}
    for (const key of ["oauth:zai:access_token", "oauth:bigmodel:access_token", "zcodejwttoken"]) localStorage.removeItem(key);
    for (const [key, value] of Object.entries(${JSON.stringify(entries)})) if (value) localStorage.setItem(key, value);
    window.dispatchEvent(new CustomEvent("zcode-rewards-context", { detail: ${JSON.stringify(parsed)} }));
  })()`;
}

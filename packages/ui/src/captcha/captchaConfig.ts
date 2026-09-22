import { captchaRuntime, type AliyunCaptchaConfig } from "./captchaRuntimeState.js";
import { CAPTCHA_CONFIG_CACHE_MS, CAPTCHA_LOCALE_PREFERENCE_KEY } from "./captchaDom.js";

export type { AliyunCaptchaConfig };

export interface CaptchaConfigSource {
  getCaptchaConfig(): Promise<unknown>;
}

export function isCaptchaConfigUnusable(config: AliyunCaptchaConfig | null | undefined): boolean {
  return !config || config.enabled === false || !config.region || !config.prefix || !config.sceneId;
}

export function readAliyunCaptchaConfig(value: unknown): AliyunCaptchaConfig | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    enabled: record.enabled,
    region: typeof record.region === "string" ? record.region : undefined,
    prefix: typeof record.prefix === "string" ? record.prefix : undefined,
    sceneId: typeof record.sceneId === "string" ? record.sceneId : undefined,
  };
}

export async function readCachedCaptchaConfig(
  service: CaptchaConfigSource | undefined,
): Promise<AliyunCaptchaConfig | null> {
  const startedAt = Date.now();
  if (captchaRuntime.configCache && captchaRuntime.configCache.expiresAt > startedAt) {
    return captchaRuntime.configCache.value;
  }
  if (!captchaRuntime.configInflight) {
    captchaRuntime.configInflight = (async () => {
      try {
        const value = readAliyunCaptchaConfig(await service?.getCaptchaConfig());
        captchaRuntime.configCache = { value, expiresAt: startedAt + CAPTCHA_CONFIG_CACHE_MS };
        return value;
      } catch {
        return null;
      }
    })().finally(() => {
      captchaRuntime.configInflight = null;
    });
  }
  return captchaRuntime.configInflight;
}

export function resolveCaptchaSdkLanguage(): "cn" | "en" {
  const stored = readStoredLocalePreference();
  if (stored === "zh-CN") return "cn";
  if (stored === "en-US") return "en";
  const language =
    typeof navigator === "undefined" || typeof navigator.language !== "string"
      ? ""
      : navigator.language.toLowerCase();
  return language.startsWith("zh") ? "cn" : "en";
}

function readStoredLocalePreference(): "zh-CN" | "en-US" | "system" | null {
  if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function")
    return null;
  const value = localStorage.getItem(CAPTCHA_LOCALE_PREFERENCE_KEY);
  if (value === "zh-CN" || value === "en-US" || value === "system") return value;
  return null;
}

export interface CaptchaAccessConfig {
  access?: { type?: string | null; mode?: string | null } | null;
}

export function isStartPlanCaptchaAccess(
  config: CaptchaAccessConfig | null | undefined,
): boolean {
  return config?.access?.type === "zhipu-account" && config.access.mode === "start-plan";
}

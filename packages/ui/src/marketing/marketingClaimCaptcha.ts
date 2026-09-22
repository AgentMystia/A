import { logger } from "@/logger.js";

interface CaptchaConfig {
  enabled?: unknown;
  region?: string;
  prefix?: string;
  sceneId?: string;
}

let cachedConfig: { value: CaptchaConfig | null; expiresAt: number } | null = null;
let inflight: Promise<CaptchaConfig | null> | null = null;

function readCaptchaConfig(value: unknown): CaptchaConfig | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    enabled: record.enabled,
    region: typeof record.region === "string" ? record.region : undefined,
    prefix: typeof record.prefix === "string" ? record.prefix : undefined,
    sceneId: typeof record.sceneId === "string" ? record.sceneId : undefined,
  };
}

export function isCaptchaConfigUnusable(config: CaptchaConfig | null): boolean {
  return !config || config.enabled === false || !config.region || !config.prefix || !config.sceneId;
}

export async function readCachedCaptchaConfig(service: {
  getCaptchaConfig(): Promise<unknown>;
}): Promise<CaptchaConfig | null> {
  const now = Date.now();
  if (cachedConfig && cachedConfig.expiresAt > now) return cachedConfig.value;
  if (!inflight) {
    inflight = (async () => {
      try {
        const value = readCaptchaConfig(await service.getCaptchaConfig());
        cachedConfig = { value, expiresAt: now + 60_000 };
        return value;
      } catch {
        return null;
      }
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export function readCaptchaRegion(value: unknown): string | undefined {
  const region = readCaptchaConfig(value)?.region?.trim();
  return region || undefined;
}

/**
 * 发布包在配置完整时调用 Aliyun runner。runner 尚未还原，不能伪造 verify param。
 * 配置不可用与 runner 缺失都返回空串，领取按 captcha 文案取消。
 */
export async function verifyManualClaimCaptcha(
  service: { getCaptchaConfig(): Promise<unknown> },
  signal: AbortSignal,
): Promise<string | undefined> {
  signal.throwIfAborted();
  const config = await readCachedCaptchaConfig(service);
  signal.throwIfAborted();
  if (isCaptchaConfigUnusable(config)) return undefined;
  logger.warn("[marketing-touch] captcha runner is not restored");
  return undefined;
}

export async function prewarmMarketingCaptcha(service: {
  getCaptchaConfig(): Promise<unknown>;
}): Promise<void> {
  const config = await readCachedCaptchaConfig(service);
  if (isCaptchaConfigUnusable(config)) return;
  throw new Error("captcha_runner_unavailable");
}

export function resetMarketingCaptchaConfigCacheForTests(): void {
  cachedConfig = null;
  inflight = null;
}

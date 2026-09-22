import {
  isCaptchaConfigUnusable,
  readCachedCaptchaConfig,
  type CaptchaConfigSource,
} from "../captcha/captchaConfig.js";
import {
  prewarmAliyunCaptcha,
  runAliyunCaptchaVerification,
} from "../captcha/aliyunCaptchaVerification.js";
import { resetCaptchaRuntimeForTests } from "../captcha/captchaRuntimeState.js";

export { isCaptchaConfigUnusable, readCachedCaptchaConfig };

export function readCaptchaRegion(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const region = (value as { region?: unknown }).region;
  return typeof region === "string" && region.trim() ? region.trim() : undefined;
}

/**
 * 发布包领取直接调用同一份 Aliyun runner。
 * 配置不可用时返回空串，由领取流程按 captcha 文案取消；可用时返回 SDK 的 verify param。
 */
export async function verifyManualClaimCaptcha(
  service: CaptchaConfigSource,
  signal: AbortSignal,
): Promise<string | undefined> {
  return runAliyunCaptchaVerification(service, { source: "send_preflight", signal });
}

export async function prewarmMarketingCaptcha(service: CaptchaConfigSource): Promise<void> {
  await prewarmAliyunCaptcha(service);
}

export function resetMarketingCaptchaConfigCacheForTests(): void {
  resetCaptchaRuntimeForTests();
}

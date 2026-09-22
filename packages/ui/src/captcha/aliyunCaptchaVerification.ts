import { logger } from "@/logger.js";

import { reportCaptchaVerification } from "./captchaArms.js";
import { prewarmAliyunCaptchaController, runCaptchaAttempt } from "./aliyunCaptchaAttempt.js";
import {
  isCaptchaConfigUnusable,
  isStartPlanCaptchaAccess,
  readCachedCaptchaConfig,
  type CaptchaAccessConfig,
  resolveCaptchaSdkLanguage,
  type CaptchaConfigSource,
} from "./captchaConfig.js";
import {
  CAPTCHA_INTERACTIVE_TIMEOUT_MS,
  CAPTCHA_VERIFY_PARAM_HEADER,
  CAPTCHA_VERIFY_REGION_HEADER,
  CAPTCHA_VERIFICATION_FAILED,
  abortable,
} from "./captchaDom.js";
import { readCertifyIdFromVerifyParam } from "./captchaResult.js";
import { captchaRuntime, type AliyunCaptchaConfig } from "./captchaRuntimeState.js";
import type { AliyunCaptchaRunConfig } from "./aliyunCaptchaSdk.js";

export interface CaptchaVerificationOptions {
  providerId?: string;
  requestId?: string;
  source?: string;
  signal?: AbortSignal;
}

function toRunConfig(config: AliyunCaptchaConfig): AliyunCaptchaRunConfig | null {
  if (
    isCaptchaConfigUnusable(config) ||
    typeof config.region !== "string" ||
    typeof config.prefix !== "string" ||
    typeof config.sceneId !== "string"
  ) {
    return null;
  }
  return {
    region: config.region,
    prefix: config.prefix,
    sceneId: config.sceneId,
    language: resolveCaptchaSdkLanguage(),
  };
}

async function enqueueCaptchaVerification<T>(
  providerId: string | undefined,
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const previous = captchaRuntime.queue;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  captchaRuntime.queue = previous.then(() => gate);
  try {
    await abortable(previous, signal);
    signal?.throwIfAborted();
    logger.debug("[captcha]", "zcode-plan verification queue slot acquired", {
      providerId: providerId ?? null,
    });
    return await run();
  } finally {
    release();
  }
}

function rememberCaptchaParam(providerId: string, param: string): void {
  const trimmed = param.trim();
  if (!trimmed) return;
  captchaRuntime.params.set(providerId.trim(), { param: trimmed, obtainedAt: Date.now() });
}

function forgetCaptchaParam(providerId: string): void {
  captchaRuntime.params.delete(providerId.trim());
}

export function noteCaptchaCertifyForSend(providerId: string, param: string): boolean {
  const certifyId = readCertifyIdFromVerifyParam(param);
  if (!certifyId) return false;
  const previous = captchaRuntime.certifyIds.get(providerId);
  const reused = previous === certifyId;
  if (reused) {
    logger.warn("[captcha] certifyId 与上一轮相同，请求可能触发 F008 重复提交", {
      providerId,
      certifyId,
    });
  }
  captchaRuntime.certifyIds.set(providerId, certifyId);
  logger.debug("[captcha]", "prepared certifyId for send", {
    providerId,
    certifyId,
    reusedFromPrevious: reused,
  });
  return reused;
}

export function buildCaptchaVerifyHeaders(input: {
  captchaVerifyParam: string;
  captchaRegion?: string;
}): Record<string, string> {
  const region = input.captchaRegion?.trim();
  return {
    [CAPTCHA_VERIFY_PARAM_HEADER]: input.captchaVerifyParam,
    ...(region ? { [CAPTCHA_VERIFY_REGION_HEADER]: region } : {}),
  };
}

export async function runAliyunCaptchaVerification(
  service: CaptchaConfigSource | undefined,
  options: CaptchaVerificationOptions = {},
): Promise<string | undefined> {
  options.signal?.throwIfAborted();
  const config = await abortable(readCachedCaptchaConfig(service), options.signal);
  options.signal?.throwIfAborted();
  const runConfig = config ? toRunConfig(config) : null;
  if (!runConfig) return undefined;
  const providerId = options.providerId?.trim();
  const source = options.source ?? "send_preflight";
  return enqueueCaptchaVerification(
    providerId,
    async () => {
      let interactive = false;
      const param = await runCaptchaAttempt(runConfig, {
        diagnosticContext: {
          requestId: options.requestId,
          providerId,
          source,
        },
        signal: options.signal,
        allowInteractive: true,
        timeoutMs: CAPTCHA_INTERACTIVE_TIMEOUT_MS,
        onInteractiveChallenge: () => {
          interactive = true;
        },
      });
      options.signal?.throwIfAborted();
      if (providerId) rememberCaptchaParam(providerId, param);
      reportCaptchaVerification({
        result: interactive ? "interactive_displayed" : "traceless_passed",
        source,
        providerId,
      });
      return param;
    },
    options.signal,
  );
}

export async function prewarmAliyunCaptcha(
  service: CaptchaConfigSource | undefined,
): Promise<void> {
  const config = await readCachedCaptchaConfig(service);
  const runConfig = config ? toRunConfig(config) : null;
  if (!runConfig) return;
  try {
    await prewarmAliyunCaptchaController(runConfig);
  } catch {
    // 发布包预热失败留到点击或发送时重试，不把脚本错误抛给 banner。
  }
}

export async function resolveStartPlanCaptchaHeaders(input: {
  providerId: string;
  requestId?: string;
  providerConfig: CaptchaAccessConfig | undefined;
  service: CaptchaConfigSource | undefined;
  source: string;
  signal?: AbortSignal;
}): Promise<{ captchaVerifyParam: string; headers: Record<string, string> } | undefined> {
  if (!isStartPlanCaptchaAccess(input.providerConfig)) return undefined;
  const config = await abortable(readCachedCaptchaConfig(input.service), input.signal);
  input.signal?.throwIfAborted();
  if (!config || isCaptchaConfigUnusable(config)) throw new Error(CAPTCHA_VERIFICATION_FAILED);
  const param = await runAliyunCaptchaVerification(input.service, {
    providerId: input.providerId,
    requestId: input.requestId,
    source: input.source,
    signal: input.signal,
  });
  if (!param?.trim()) throw new Error(CAPTCHA_VERIFICATION_FAILED);
  noteCaptchaCertifyForSend(input.providerId, param);
  const headers = buildCaptchaVerifyHeaders({
    captchaVerifyParam: param,
    captchaRegion: config.region,
  });
  forgetCaptchaParam(input.providerId);
  return { captchaVerifyParam: param, headers };
}

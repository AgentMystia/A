import { logger } from "@/logger.js";

import { captchaRuntime, type CaptchaArmsReporter } from "./captchaRuntimeState.js";

const CAPTCHA_ARMS_EVENT = "aliyun_captcha_verification";
const CAPTCHA_ARMS_GROUP = "captcha";

export type CaptchaArmsResult = "traceless_passed" | "interactive_displayed" | "interactive_passed";

export function setCaptchaArmsReporter(reporter: CaptchaArmsReporter | null): void {
  captchaRuntime.arms = reporter;
}

export function reportCaptchaVerification(input: {
  result: CaptchaArmsResult;
  source: string;
  providerId?: string;
}): void {
  const reporter = captchaRuntime.arms;
  if (!reporter) return;
  const tracelessPassed = input.result === "traceless_passed";
  const displayed =
    input.result === "interactive_displayed" || input.result === "interactive_passed";
  void reporter
    .reportArmsCustomEvent({
      name: CAPTCHA_ARMS_EVENT,
      group: CAPTCHA_ARMS_GROUP,
      value: 1,
      properties: {
        result: input.result,
        source: input.source,
        provider_id: input.providerId,
        traceless_passed: tracelessPassed,
        captcha_displayed: displayed,
        traceless_passed_count: tracelessPassed ? 1 : 0,
        captcha_displayed_count: displayed ? 1 : 0,
      },
    })
    .catch((error: unknown) => {
      logger.warn("[captcha] ARMS 自定义事件上报失败", {
        result: input.result,
        source: input.source,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

import assert from "node:assert/strict";
import test from "node:test";

import { resolveTelemetryAttribution } from "../src/lib/chatErrorAttribution.js";
import { resolveVisibleChatErrorTelemetryRecoveryAction } from "../src/lib/chatErrorBannerTelemetry.js";
import { resolveCaptchaVerifyFailedBusinessCode } from "../src/lib/providerBusinessError.js";
import { normalizeZCodeUiError } from "../src/lib/zcodeUiError.js";

test("captcha classifier keeps exact codes and published phrases", () => {
  assert.equal(resolveCaptchaVerifyFailedBusinessCode("3007", undefined), "3007");
  assert.equal(resolveCaptchaVerifyFailedBusinessCode("CAPTCHA_VERIFY_FAILED", "x"), "3007");
  assert.equal(resolveCaptchaVerifyFailedBusinessCode(" 3007 ", "plain"), undefined);
  assert.equal(resolveCaptchaVerifyFailedBusinessCode("SEND_FAILED", "   "), undefined);
  assert.equal(
    resolveCaptchaVerifyFailedBusinessCode(
      "SEND_FAILED",
      "Captcha verification failed or the verify token was rejected.",
    ),
    "3007",
  );
  assert.equal(
    resolveCaptchaVerifyFailedBusinessCode("SEND_FAILED", "upstream verify token was rejected"),
    "3007",
  );
  assert.equal(
    resolveCaptchaVerifyFailedBusinessCode("SEND_FAILED", "Verify token was rejected"),
    undefined,
  );
  assert.equal(
    resolveCaptchaVerifyFailedBusinessCode("SEND_FAILED", "CAPTCHA VERIFY FAILED"),
    "3007",
  );
  assert.equal(
    resolveCaptchaVerifyFailedBusinessCode("SEND_FAILED", "验证码校验失败，请重试。"),
    "3007",
  );
  assert.equal(
    resolveCaptchaVerifyFailedBusinessCode("SEND_FAILED", "captcha verification failed later"),
    "3007",
  );
});

test("normalize prefers captcha classification before detail provider codes", () => {
  assert.equal(
    normalizeZCodeUiError({
      code: "CAPTCHA_VERIFY_FAILED",
      message: "rejected",
      detail: "provider_code=1005",
    }).code,
    "3007",
  );
  assert.equal(
    normalizeZCodeUiError({
      code: "PROVIDER_BUSINESS_ERROR",
      message: "quota",
      detail: "provider_code=1005",
    }).code,
    "1005",
  );
  assert.equal(
    normalizeZCodeUiError({
      message: "验证码校验失败，请重试。",
    }).code,
    "3007",
  );
});

test("captcha classification suppresses visible recovery actions", () => {
  assert.deepEqual(
    resolveVisibleChatErrorTelemetryRecoveryAction({
      code: "1006",
      message: "please login",
    }),
    { kind: "login", providerBusinessCode: "1006" },
  );
  assert.equal(
    resolveVisibleChatErrorTelemetryRecoveryAction({
      code: "1006",
      message: "Captcha verification failed or the verify token was rejected.",
    }),
    null,
  );
  assert.equal(
    resolveVisibleChatErrorTelemetryRecoveryAction({
      code: "CAPTCHA_VERIFY_FAILED",
      message: "x",
    }),
    null,
  );
});

test("CAPTCHA_VERIFY_FAILED attribution stays provider auth_failed", () => {
  assert.deepEqual(
    resolveTelemetryAttribution({
      error: { code: "CAPTCHA_VERIFY_FAILED", message: "x" },
      displayMessage: "x",
    }),
    { errorSource: "provider", failureReason: "auth_failed" },
  );
});

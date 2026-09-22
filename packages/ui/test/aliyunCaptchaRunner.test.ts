import assert from "node:assert/strict";
import { test } from "node:test";

import { ALIYUN_CAPTCHA_LOGO } from "../src/captcha/captchaLogo.ts";
import {
  buildCaptchaVerifyHeaders,
  noteCaptchaCertifyForSend,
  prewarmAliyunCaptcha,
} from "../src/captcha/aliyunCaptchaVerification.ts";
import {
  isStartPlanCaptchaAccess,
  resolveCaptchaSdkLanguage,
} from "../src/captcha/captchaConfig.ts";
import {
  classifyCaptchaFailureKind,
  isCaptchaInteractiveRequired,
  isCaptchaTerminalPass,
  isDuplicateCaptchaSubmission,
  readCaptchaSdkCode,
  readCaptchaVerifyParam,
  readCertifyIdFromVerifyParam,
} from "../src/captcha/captchaResult.ts";
import { resetCaptchaRuntimeForTests } from "../src/captcha/captchaRuntimeState.ts";
import { providerRuntimeHeadersRequestKey } from "../src/captcha/providerRuntimeHeadersCaptcha.ts";

test("captcha result parsers match the published fail and pass rules", () => {
  assert.equal(isDuplicateCaptchaSubmission({ verifyCode: "F008", message: "请勿重复提交" }), true);
  assert.equal(isDuplicateCaptchaSubmission({ verifyCode: "F008", message: "ok" }), false);
  assert.equal(isDuplicateCaptchaSubmission("F008 重复提交"), false);
  assert.equal(isCaptchaTerminalPass({ verifyCode: "T006" }), true);
  assert.equal(isCaptchaTerminalPass({ success: true, verifyResult: true }), true);
  assert.equal(isCaptchaTerminalPass({ success: true, verifyResult: false }), false);
  assert.equal(isCaptchaInteractiveRequired({ success: true, verifyResult: false }), true);
  assert.equal(isCaptchaInteractiveRequired({ success: true, verifyResult: true }), true);
  assert.equal(
    isCaptchaInteractiveRequired({
      success: true,
      verifyResult: true,
      captchaVerifyParam: "param",
    }),
    false,
  );
  assert.equal(readCaptchaVerifyParam({ CaptchaVerifyParam: " tok " }), "tok");
  assert.equal(readCaptchaVerifyParam({}), undefined);
  assert.equal(readCertifyIdFromVerifyParam('{"certifyId":"c1"}'), "c1");
  assert.equal(readCertifyIdFromVerifyParam("plain"), undefined);
  assert.equal(readCaptchaSdkCode({ code: "INIT_FAIL" }), "INIT_FAIL");
  assert.equal(readCaptchaSdkCode({ verifyCode: "F008" }), "F008");
  assert.equal(readCaptchaSdkCode({ code: "nope" }), undefined);
  assert.equal(
    classifyCaptchaFailureKind(new Error("Captcha instance timed out after 10000ms.")),
    "instance_timeout",
  );
  assert.equal(
    classifyCaptchaFailureKind(new Error("Failed to load captcha script.")),
    "script_load_failed",
  );
  assert.equal(
    classifyCaptchaFailureKind(new Error("Captcha verification timed out after 120000ms.")),
    "verification_timeout",
  );
  assert.equal(
    classifyCaptchaFailureKind(new Error("Traceless captcha timed out after 8000ms.")),
    "traceless_timeout",
  );
  assert.equal(classifyCaptchaFailureKind(new Error("other")), "unknown");
});

test("captcha headers, start-plan gate, certify id and logo stay on the published contract", () => {
  resetCaptchaRuntimeForTests();
  assert.deepEqual(
    buildCaptchaVerifyHeaders({ captchaVerifyParam: "param", captchaRegion: " cn " }),
    {
      "X-Aliyun-Captcha-Verify-Param": "param",
      "X-Aliyun-Captcha-Verify-Region": "cn",
    },
  );
  assert.deepEqual(buildCaptchaVerifyHeaders({ captchaVerifyParam: "param", captchaRegion: " " }), {
    "X-Aliyun-Captcha-Verify-Param": "param",
  });
  assert.equal(
    isStartPlanCaptchaAccess({ access: { type: "zhipu-account", mode: "start-plan" } }),
    true,
  );
  assert.equal(
    isStartPlanCaptchaAccess({ access: { type: "zhipu-account", mode: "off-peak" } }),
    false,
  );
  assert.equal(isStartPlanCaptchaAccess(undefined), false);
  assert.equal(noteCaptchaCertifyForSend("glm", '{"certifyId":"same"}'), false);
  assert.equal(noteCaptchaCertifyForSend("glm", '{"certifyId":"same"}'), true);
  assert.equal(noteCaptchaCertifyForSend("glm", "not-json"), false);
  assert.equal(ALIYUN_CAPTCHA_LOGO.startsWith("data:image/png;base64,iVBORw0KGgo"), true);
  assert.equal(ALIYUN_CAPTCHA_LOGO.length, 5242);
  assert.equal(
    providerRuntimeHeadersRequestKey({
      workspace: { workspaceIdentity: " remote ", workspacePath: "/tmp/ws" },
      sessionId: "session",
      requestId: "request",
    }),
    "remote::session::request",
  );
  resetCaptchaRuntimeForTests();
});

test("captcha sdk language follows the locale preference and navigator", () => {
  const storage = new Map<string, string>();
  const previousStorage = globalThis.localStorage;
  const previousNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language: "zh-Hans" },
  });
  try {
    storage.set("zcode-locale-preference", "zh-CN");
    assert.equal(resolveCaptchaSdkLanguage(), "cn");
    storage.set("zcode-locale-preference", "en-US");
    assert.equal(resolveCaptchaSdkLanguage(), "en");
    storage.set("zcode-locale-preference", "system");
    assert.equal(resolveCaptchaSdkLanguage(), "cn");
    storage.delete("zcode-locale-preference");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { language: "en-GB" },
    });
    assert.equal(resolveCaptchaSdkLanguage(), "en");
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previousStorage,
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: previousNavigator,
    });
  }
});

test("captcha prewarm swallows a missing browser", async () => {
  resetCaptchaRuntimeForTests();
  await prewarmAliyunCaptcha({
    async getCaptchaConfig() {
      return { enabled: true, region: "cn", prefix: "p", sceneId: "s" };
    },
  });
  resetCaptchaRuntimeForTests();
});

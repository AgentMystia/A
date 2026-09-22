import assert from "node:assert/strict";
import test from "node:test";
import type { ZCodeProviderAccountAccess } from "@zcode/shared";
import {
  mergeCaptchaRuntimeProviderHeaders,
  shouldDeferProviderRuntimeHeadersToRenderer,
} from "../src/zcode-agent/providerRuntimeHeadersDelivery.js";

function access(mode: ZCodeProviderAccountAccess["mode"]): ZCodeProviderAccountAccess {
  return {
    type: "zhipu-account",
    accountType: "bigmodel",
    mode,
    entitled: true,
  };
}

test("start-plan and missing auth stay on the renderer path", () => {
  assert.equal(shouldDeferProviderRuntimeHeadersToRenderer(false, undefined), true);
  assert.equal(shouldDeferProviderRuntimeHeadersToRenderer(true, undefined), true);
  assert.equal(
    shouldDeferProviderRuntimeHeadersToRenderer(false, access("individual-coding-plan")),
    true,
  );
  assert.equal(shouldDeferProviderRuntimeHeadersToRenderer(true, access("start-plan")), true);
  assert.equal(
    shouldDeferProviderRuntimeHeadersToRenderer(true, access("individual-coding-plan")),
    false,
  );
  assert.equal(
    shouldDeferProviderRuntimeHeadersToRenderer(true, access("team-coding-plan")),
    false,
  );
  assert.equal(shouldDeferProviderRuntimeHeadersToRenderer(true, access("off-peak")), false);
});

test("captcha header merge keeps only the two published names", () => {
  assert.equal(mergeCaptchaRuntimeProviderHeaders(undefined, undefined), undefined);
  assert.equal(mergeCaptchaRuntimeProviderHeaders({ apiKey: "" }, undefined), undefined);
  assert.deepEqual(mergeCaptchaRuntimeProviderHeaders({ apiKey: "key" }, undefined), {
    apiKey: "key",
  });
  assert.deepEqual(
    mergeCaptchaRuntimeProviderHeaders(
      { apiKey: "key", headers: { Authorization: "Bearer kept" } },
      {
        " x-aliyun-captcha-verify-param ": "  param  ",
        "X-ALIYUN-CAPTCHA-VERIFY-REGION": "cn",
        "X-Other": "drop",
        "X-Aliyun-Captcha-Verify-Param": "   ",
      },
    ),
    {
      apiKey: "key",
      headers: {
        Authorization: "Bearer kept",
        "X-Aliyun-Captcha-Verify-Param": "param",
        "X-Aliyun-Captcha-Verify-Region": "cn",
      },
    },
  );
  assert.deepEqual(
    mergeCaptchaRuntimeProviderHeaders(undefined, {
      "X-Aliyun-Captcha-Verify-Region": " cn ",
    }),
    { headers: { "X-Aliyun-Captcha-Verify-Region": "cn" } },
  );
});

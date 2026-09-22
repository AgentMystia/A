import assert from "node:assert/strict";
import test from "node:test";
import type { ApiClient } from "@zcode/shared";
import type { ICredentialService } from "../src/credential/credential.js";
import { createCodingPlanSubscriptionService } from "../src/coding-plan-subscription/codingPlanSubscriptionService.js";

function credentials(): Pick<ICredentialService, "load"> {
  return { load: async () => null };
}

function jsonClient(payload: unknown, calls: { n: number }): ApiClient {
  return {
    request: async () => {
      calls.n += 1;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

test("published billing discount unwraps the client config key and captcha ignores code", async () => {
  const discount = { "zh-CN": { badgeBody: "150%" } };
  const calls = { n: 0 };
  const service = createCodingPlanSubscriptionService({
    apiClient: jsonClient(
      {
        code: 0,
        data: { configs: { codingPlanBillingDiscount: discount, captcha: { enabled: false } } },
      },
      calls,
    ),
    credentialService: credentials(),
  });

  assert.deepEqual(await service.getBillingDiscount(), discount);
  assert.deepEqual(await service.getCaptchaConfig(), { enabled: false });
  // client/configs 快照归 provider，第二次读取不再打远端。
  assert.equal(calls.n, 1);
});

test("missing billing discount key is undefined and missing captcha is null", async () => {
  const service = createCodingPlanSubscriptionService({
    apiClient: jsonClient({ code: 0, data: { configs: { captcha: "" } } }, { n: 0 }),
    credentialService: credentials(),
  });
  assert.equal(await service.getBillingDiscount(), undefined);
  assert.equal(await service.getCaptchaConfig(), "");

  const absent = createCodingPlanSubscriptionService({
    apiClient: jsonClient({ data: { configs: null } }, { n: 0 }),
    credentialService: credentials(),
  });
  assert.equal(await absent.getBillingDiscount(), undefined);
  assert.equal(await absent.getCaptchaConfig(), null);
});

test("billing discount throws the trimmed client config message and captcha still returns", async () => {
  const calls = { n: 0 };
  const service = createCodingPlanSubscriptionService({
    apiClient: jsonClient(
      { code: 7, msg: "  busy  ", data: { configs: { captcha: { sceneId: "s" } } } },
      calls,
    ),
    credentialService: credentials(),
  });
  assert.deepEqual(await service.getCaptchaConfig(), { sceneId: "s" });
  await assert.rejects(service.getBillingDiscount(), { message: "busy" });
  assert.equal(calls.n, 1);

  const empty = createCodingPlanSubscriptionService({
    apiClient: jsonClient({ code: 3, msg: "   " }, { n: 0 }),
    credentialService: credentials(),
  });
  await assert.rejects(empty.getBillingDiscount(), {
    message: "ZCode client config request failed",
  });
});

test("present billing discount values are returned without extra validation", async () => {
  const service = createCodingPlanSubscriptionService({
    apiClient: jsonClient(
      { code: 0, data: { configs: { codingPlanBillingDiscount: false } } },
      { n: 0 },
    ),
    credentialService: credentials(),
  });
  assert.equal(await service.getBillingDiscount(), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  CODING_PLAN_BILLING_DISCOUNT_CACHE_TTL_MS,
  clearCodingPlanBillingDiscountCache,
  isCodingPlanBillingDiscountCopyComplete,
  loadCodingPlanBillingDiscount,
  readCodingPlanBillingDiscountCopy,
} from "../src/settings/model-provider-section/codingPlanBillingDiscountCache.js";

test("billing discount copy trims locale fields and activates on badgeBody", () => {
  const config = {
    "zh-CN": {
      badgeBody: "  150%  ",
      cardTitle: " ",
      cardBody: 1,
      infoTitle: "规则",
      infoBody: "说明",
    },
    "en-US": { badgeBody: "" },
  };
  assert.deepEqual(readCodingPlanBillingDiscountCopy(config, "zh-CN"), {
    badgeBody: "150%",
    cardTitle: undefined,
    cardBody: undefined,
    infoTitle: "规则",
    infoBody: "说明",
  });
  assert.equal(isCodingPlanBillingDiscountCopyComplete(config, "zh-CN", ["badgeBody"]), true);
  assert.equal(isCodingPlanBillingDiscountCopyComplete(config, "en-US", ["badgeBody"]), false);
  assert.equal(
    isCodingPlanBillingDiscountCopyComplete(config, "zh-CN", ["badgeBody", "cardTitle"]),
    false,
  );
  assert.deepEqual(readCodingPlanBillingDiscountCopy(null, "zh-CN"), {});
  assert.deepEqual(
    readCodingPlanBillingDiscountCopy({ "zh-CN": ["150%"] }, "zh-CN").badgeBody,
    undefined,
  );
});

test("billing discount cache lasts one hour, shares one request, and drops failures", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  clearCodingPlanBillingDiscountCache();
  try {
    let calls = 0;
    let fail = true;
    const value = { "zh-CN": { badgeBody: "150%" } };
    const service = {
      getBillingDiscount() {
        calls += 1;
        if (fail) return Promise.reject(new Error("down"));
        return Promise.resolve(value);
      },
    };
    await assert.rejects(loadCodingPlanBillingDiscount(service), { message: "down" });
    fail = false;
    const first = loadCodingPlanBillingDiscount(service);
    const second = loadCodingPlanBillingDiscount(service);
    assert.equal(await first, value);
    assert.equal(await second, value);
    assert.equal(calls, 2);
    await loadCodingPlanBillingDiscount(service);
    assert.equal(calls, 2);
    t.mock.timers.tick(CODING_PLAN_BILLING_DISCOUNT_CACHE_TTL_MS);
    await loadCodingPlanBillingDiscount(service);
    assert.equal(calls, 3);
  } finally {
    clearCodingPlanBillingDiscountCache();
    t.mock.timers.reset();
  }
});

import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { MarketingDelivery } from "@zcode/shared";

import {
  isCaptchaConfigUnusable,
  readCachedCaptchaConfig,
  resetMarketingCaptchaConfigCacheForTests,
  verifyManualClaimCaptcha,
} from "../src/marketing/marketingClaimCaptcha.ts";
import {
  acknowledgeMarketingNavigation,
  requestMarketingNavigation,
  resetMarketingNavigationForTests,
} from "../src/marketing/marketingNavigation.ts";
import {
  createMarketingTouchPoller,
  marketingPollDelayMs,
  marketingPollIntervalMs,
} from "../src/marketing/marketingTouchPoller.ts";
import {
  createMarketingTouchController,
  type MarketingPreparedDelivery,
} from "../src/marketing/marketingTouchController.ts";

const popup = {
  campaign_id: "camp",
  priority: 1,
  resource_position: "popup",
  popup: {
    title: { format: "plaintext", content: "Hi" },
    description: { format: "plaintext", content: "Body" },
    buttons: [{ text: { format: "plaintext", content: "Close" }, action: { type: "close" } }],
  },
} as MarketingDelivery;

function prepared(
  delivery: MarketingDelivery,
  release = async () => undefined,
): MarketingPreparedDelivery {
  return { delivery, hero: null, release, scope: "scope" };
}

test("production poll interval is ten minutes and failures back off", () => {
  assert.equal(marketingPollIntervalMs("production"), 600_000);
  assert.equal(marketingPollIntervalMs("development"), 30_000);
  assert.equal(marketingPollDelayMs(0, 1_000), 1_000);
  assert.equal(marketingPollDelayMs(1, 1_000), 30_000);
  assert.equal(marketingPollDelayMs(2, 1_000), 60_000);
  assert.equal(marketingPollDelayMs(9, 1_000), 600_000);
});

test("poller retries a failed query on the backoff and stops after dispose", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let calls = 0;
    let fail = true;
    const poller = createMarketingTouchPoller({
      intervalMs: 1_000,
      visible: () => true,
      query: async () => {
        calls += 1;
        if (fail) throw new Error("offline");
      },
    });
    poller.refresh();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls, 1);
    mock.timers.tick(30_000);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls, 2);
    fail = false;
    mock.timers.tick(60_000);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls, 3);
    mock.timers.tick(999);
    assert.equal(calls, 3);
    mock.timers.tick(1);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls, 4);
    poller.dispose();
    mock.timers.tick(30_000);
    assert.equal(calls, 4);
  } finally {
    mock.timers.reset();
  }
});

test("controller opens a popup only when the surface can open", async () => {
  let open = false;
  const releases: string[] = [];
  const controller = createMarketingTouchController({
    query: async () => ({
      serverTime: 1,
      language: "en-US",
      deliveries: [popup],
      rejectedCount: 0,
      scope: "11111111-1111-1111-1111-111111111111",
    }),
    report: async () => undefined,
    locale: "en-US",
    canOpen: () => open,
    refresh: () => undefined,
    prepare: async (delivery) =>
      prepared(delivery, async () => {
        releases.push(delivery.campaign_id);
      }),
    execute: async () => ({ status: "success" }),
  });
  await controller.refresh();
  await controller.showPending();
  assert.equal(controller.store.getState().dialog, null);
  open = true;
  await controller.showPending();
  assert.equal(controller.store.getState().dialog?.delivery.campaign_id, "camp");
  assert.equal(controller.store.getState().dialog?.result, false);
  await controller.closeDialog();
  assert.equal(controller.store.getState().dialog, null);
  assert.deepEqual(releases, ["camp"]);
  controller.dispose();
});

test("banner success keeps the release for the follow-up dialog", async () => {
  const banner = {
    campaign_id: "banner",
    priority: 1,
    resource_position: "banner",
    banner: {
      background: {
        type: "image",
        image: {
          default: { src: "https://example.com/a.png", sha256: "a".repeat(64) },
        },
      },
      buttons: [
        {
          text: { format: "plaintext", content: "Go" },
          action: { type: "open_url", args: { url: "https://example.com/go" } },
        },
      ],
      success_popup: {
        title: { format: "plaintext", content: "Done" },
        description: { format: "plaintext", content: "Body" },
        buttons: [{ text: { format: "plaintext", content: "Close" }, action: { type: "close" } }],
      },
    },
  } as MarketingDelivery;
  let released = 0;
  const controller = createMarketingTouchController({
    query: async () => ({
      serverTime: 1,
      language: "en-US",
      deliveries: [banner],
      rejectedCount: 0,
      scope: "11111111-1111-1111-1111-111111111111",
    }),
    report: async () => undefined,
    locale: "en-US",
    canOpen: () => true,
    refresh: () => undefined,
    prepare: async (delivery) => ({
      ...prepared(delivery, async () => {
        released += 1;
      }),
      image: "https://example.com/a.png",
      success: Promise.resolve({
        hero: { type: "image", src: "https://example.com/a.png", alt: "" },
      }),
    }),
    execute: async (action) => {
      assert.equal(action.type, "open_url");
      return { status: "success" };
    },
  });
  await controller.refresh();
  await controller.clickBanner();
  assert.equal(released, 0);
  assert.equal(controller.store.getState().dialog?.result, true);
  assert.equal(controller.store.getState().banner, null);
  controller.dispose();
  assert.equal(released, 1);
});

test("navigation waits for acknowledgement and rejects a second request", async () => {
  resetMarketingNavigationForTests();
  const signal = new AbortController().signal;
  const pending = requestMarketingNavigation({ page: "rewards" }, signal, () => undefined);
  await assert.rejects(
    requestMarketingNavigation({ page: "rewards" }, signal, () => undefined),
    /marketing_navigation_busy/,
  );
  acknowledgeMarketingNavigation(1);
  await pending;
  resetMarketingNavigationForTests();
});

test("navigation times out when the destination never acknowledges", async () => {
  resetMarketingNavigationForTests();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const signal = new AbortController().signal;
    const pending = requestMarketingNavigation({ page: "upgrade" }, signal, () => undefined);
    mock.timers.tick(30_000);
    await assert.rejects(pending, /marketing_capability_timeout/);
  } finally {
    mock.timers.reset();
    resetMarketingNavigationForTests();
  }
});

test("captcha config cache is shared and a usable config reaches the runner", async () => {
  resetMarketingCaptchaConfigCacheForTests();
  assert.equal(isCaptchaConfigUnusable(null), true);
  assert.equal(
    isCaptchaConfigUnusable({ enabled: true, region: "cn", prefix: "p", sceneId: "s" }),
    false,
  );
  const service = {
    async getCaptchaConfig() {
      return { enabled: true, region: "cn", prefix: "p", sceneId: "s" };
    },
  };
  const first = await readCachedCaptchaConfig(service);
  const second = await readCachedCaptchaConfig({
    async getCaptchaConfig() {
      throw new Error("should use cache");
    },
  });
  assert.equal(first, second);
  const signal = new AbortController().signal;
  await assert.rejects(
    verifyManualClaimCaptcha(service, signal),
    /Captcha requires browser environment/,
  );
  resetMarketingCaptchaConfigCacheForTests();
  assert.equal(
    await verifyManualClaimCaptcha(
      {
        async getCaptchaConfig() {
          return { enabled: false, region: "cn", prefix: "p", sceneId: "s" };
        },
      },
      signal,
    ),
    undefined,
  );
  resetMarketingCaptchaConfigCacheForTests();
});

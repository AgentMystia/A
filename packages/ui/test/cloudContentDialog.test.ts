import assert from "node:assert/strict";
import test from "node:test";

import { BUILTIN_MODEL_PROVIDER_IDS } from "@zcode/shared";

import {
  buildCloudDialogPayload,
  projectMarketingHeroData,
  readCloudHeroInboundMessage,
} from "../src/marketing/cloudDialogModel.js";
import { fetchLottieDocument, validateLottieDocument } from "../src/marketing/lottieDocument.js";
import { isAllowedMarketingStyleDeclaration } from "../src/marketing/marketingStyle.js";
import { resolveMarketingHero } from "../src/marketing/resolveMarketingHero.js";

const asset = {
  src: "https://cdn.example/asset.png",
  sha256: "a".repeat(64),
};

test("lottie document rejects external assets and accepts a bounded animation", () => {
  assert.deepEqual(
    validateLottieDocument({ w: 32, h: 32, fr: 30, ip: 0, op: 30, layers: [] }).w,
    32,
  );
  assert.throws(
    () => validateLottieDocument({ w: 0, h: 32, fr: 30, ip: 0, op: 30, layers: [] }),
    /lottie_dimensions/,
  );
  assert.throws(
    () => validateLottieDocument({ w: 32, h: 32, fr: 30, ip: 0, op: 30, layers: [], fonts: {} }),
    /lottie_external_or_expression/,
  );
  assert.throws(
    () => validateLottieDocument({ w: 32, h: 32, fr: 30, ip: 0, op: 30, layers: [{ p: "expr" }] }),
    /lottie_external_or_expression/,
  );
  let nested: unknown = { ok: true };
  for (let depth = 0; depth < 45; depth += 1) {
    nested = { child: nested };
  }
  assert.throws(
    () => validateLottieDocument({ w: 1, h: 1, fr: 1, ip: 0, op: 1, layers: [nested] }),
    /lottie_complexity/,
  );
});

test("lottie fetch stops above 2MiB and validates the document", async () => {
  const originalFetch = globalThis.fetch;
  const payload = JSON.stringify({ w: 8, h: 8, fr: 12, ip: 0, op: 12, layers: [] });
  try {
    globalThis.fetch = (async () =>
      new Response(new TextEncoder().encode(payload), { status: 200 })) as typeof fetch;
    const result = await fetchLottieDocument(
      "https://cdn.example/hero.json",
      new AbortController().signal,
    );
    assert.equal(result.fr, 12);

    globalThis.fetch = (async () =>
      new Response(new Uint8Array(2 * 1024 * 1024 + 1), { status: 200 })) as typeof fetch;
    await assert.rejects(
      fetchLottieDocument("https://cdn.example/huge.json", new AbortController().signal),
      /lottie_size/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("marketing style allowlist keeps theme tokens and drops expressions", () => {
  assert.equal(isAllowedMarketingStyleDeclaration("color", "var(--color-foreground)"), true);
  assert.equal(isAllowedMarketingStyleDeclaration("font-size", "var(--text-ui-base)"), true);
  assert.equal(isAllowedMarketingStyleDeclaration("font-size", "12px"), false);
  assert.equal(isAllowedMarketingStyleDeclaration("margin", "40px"), false);
  assert.equal(isAllowedMarketingStyleDeclaration("margin", "8px"), true);
  assert.equal(isAllowedMarketingStyleDeclaration("color", "expression(alert(1))"), false);
  assert.equal(isAllowedMarketingStyleDeclaration("text-decoration", "underline dashed"), true);
});

test("cloud dialog payload keeps campaign actions and rewrites navigate destinations", () => {
  const payload = buildCloudDialogPayload({
    campaignId: "camp",
    locale: "zh-CN",
    hero: null,
    modelSettingsLabel: "查看套餐",
    popup: {
      title: { format: "plaintext", content: "标题" },
      description: { format: "markdown", content: "说明" },
      buttons: [
        { text: { format: "plaintext", content: "关闭" }, action: { type: "close" } },
        {
          text: { format: "plaintext", content: "领取" },
          action: { type: "claim_zcode_plan", args: { plan_id: "plan-1" } },
        },
        {
          text: { format: "plaintext", content: "插件" },
          action: { type: "navigate", args: { page: "plugin_marketplace" } },
        },
        {
          text: { format: "plaintext", content: "模型" },
          action: {
            type: "navigate",
            args: {
              page: "settings",
              section: "models",
              provider_id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
            },
          },
        },
      ],
    },
  });
  assert.equal(payload.dialog.formattedTitle.format, "plain_text");
  assert.equal(payload.dialog.description.format, "markdown");
  assert.deepEqual(payload.actions["button-1"], { type: "claim_plan", planId: "plan-1" });
  assert.deepEqual(payload.actions["button-2"], { type: "navigate", destination: "plugin_store" });
  assert.equal(payload.dialog.buttons[3]?.label, "查看套餐");
  assert.equal(payload.dialog.buttons[3]?.formattedLabel.format, "plain_text");
  assert.equal(payload.dialog.buttons[0]?.variant, "secondary");
});

test("interactive hero data projects the largest model usage grant", () => {
  const data = projectMarketingHeroData(
    {
      zcode_plan: {
        name: "Start",
        ends_at: 1_700_000_000,
        entitlements: [
          { meter: "model_usage", grant_units: 10, show_name: "GLM", unit_type: "tokens" },
          { meter: "model_usage", grant_units: 30, show_name: "GLM-X", unit_type: "tokens" },
          { meter: "other", grant_units: 99, show_name: "skip" },
        ],
      },
    },
    "en-US",
  );
  assert.equal(data.planName, "Start");
  assert.equal(data.amountValue, "30");
  assert.equal(data.amountUnit, "tokens");
  assert.deepEqual(data.benefits, ["GLM · 10 tokens", "GLM-X · 30 tokens"]);
  assert.equal(data.replayLabel, "Replay");
  assert.equal(
    readCloudHeroInboundMessage({
      channel: "zcode-cloud-hero-v1",
      type: "resize",
      instanceId: "a",
      height: Number.NaN,
    }),
    null,
  );
  assert.equal(
    readCloudHeroInboundMessage({
      channel: "zcode-cloud-hero-v1",
      type: "ready",
      instanceId: "cloud-hero-1",
    })?.type,
    "ready",
  );
});

test("hero resolver leaves an empty result without a media port and prepares desktop bundles", async () => {
  const empty = await resolveMarketingHero({
    visual: { type: "image", image: { default: asset } },
    media: null,
    locale: "en-US",
    desktop: true,
  });
  assert.equal(empty.hero, null);

  const releases: string[] = [];
  const media = {
    async readPublishedMedia() {
      return "data:image/png;base64,aa";
    },
    async prepare() {
      return { leaseId: "lease-1", cacheHit: false, url: "http://127.0.0.1/hero.html" };
    },
    async release(request: { leaseId: string }) {
      releases.push(request.leaseId);
    },
  };
  const originalImage = globalThis.Image;
  globalThis.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  } as unknown as typeof Image;
  try {
    const resolved = await resolveMarketingHero({
      visual: {
        type: "bundle",
        bundle: { bundle: asset, entry: "index.html", fallback: asset },
      },
      media,
      locale: "zh-CN",
      desktop: true,
    });
    assert.equal(resolved.hero?.type, "interactive_bundle");
    if (resolved.hero?.type === "interactive_bundle") {
      assert.equal(resolved.hero.resolvedUrl, "http://127.0.0.1/hero.html");
      assert.equal(resolved.hero.events.replay, "replay");
      assert.equal(resolved.hero.fallback?.src, "data:image/png;base64,aa");
    }
    await resolved.release();
    await resolved.release();
    assert.deepEqual(releases, ["lease-1"]);

    const web = await resolveMarketingHero({
      visual: { type: "bundle", bundle: { bundle: asset, entry: "index.html" } },
      media,
      locale: "en-US",
      desktop: false,
    });
    assert.equal(web.hero, null);
  } finally {
    globalThis.Image = originalImage;
  }
});

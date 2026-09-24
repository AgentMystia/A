import assert from "node:assert/strict";
import test from "node:test";

import { createMarketingAssetRegistry } from "./marketingAssetRegistry.js";

const asset = {
  src: "https://cdn.example/a.png",
  sha256: "a".repeat(64),
};

test("image download stops past 8MiB", async () => {
  const registry = createMarketingAssetRegistry({
    fetch: async () =>
      ({
        ok: true,
        body: (async function* () {
          yield Buffer.alloc(8 * 1024 * 1024 + 1);
        })(),
      }) as unknown as Response,
  });
  registry.allow(asset);
  await assert.rejects(() => registry.readMedia(asset, "image"), /marketing_asset_size/);
});

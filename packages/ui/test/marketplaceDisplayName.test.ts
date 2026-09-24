import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID,
  ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
} from "@zcode/shared";
import type { ZCodePluginMarketplaceSummary } from "@zcode/shared";

import { resolveMarketplaceDisplayName } from "../src/settings/pluginSourceLabel.js";
import { sortMarketplaceSources } from "../src/settings/pluginStoreListing.js";

test("claude plugins official marketplace uses the formatted title", () => {
  assert.equal(
    resolveMarketplaceDisplayName(
      CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID,
      [{ id: CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID, name: "raw-name" }],
      "Claude Code Plugins",
    ),
    "Claude Code Plugins",
  );
  assert.equal(
    resolveMarketplaceDisplayName("other", [{ id: "other", name: "Other Market" }]),
    "Other Market",
  );
  assert.equal(resolveMarketplaceDisplayName("missing", []), "missing");
});

test("claude plugins official stays pinned after the ZCode marketplace", () => {
  const source = (id: string, name: string): ZCodePluginMarketplaceSummary =>
    ({ id, name, source: id, pluginCount: 0 }) as ZCodePluginMarketplaceSummary;
  const sorted = sortMarketplaceSources(
    [
      source("custom", "Custom"),
      source(CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID, "Claude"),
      source(ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID, "ZCode"),
    ],
    "en",
  );
  assert.deepEqual(
    sorted.map((marketplace) => marketplace.id),
    [ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID, CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID, "custom"],
  );
});

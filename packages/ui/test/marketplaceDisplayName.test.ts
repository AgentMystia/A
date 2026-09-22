import assert from "node:assert/strict";
import test from "node:test";
import { CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID } from "@zcode/shared";

import { resolveMarketplaceDisplayName } from "../src/settings/pluginSourceLabel.js";

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

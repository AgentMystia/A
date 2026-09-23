import assert from "node:assert/strict";
import test from "node:test";

import { persistLastAgentProvider } from "../src/lib/lastAgentProviderPreference.js";

test("startDraft persistence writes the normalized provider", () => {
  const writes: Array<[string, string]> = [];
  persistLastAgentProvider("glm", {
    setItem(key, value) {
      writes.push([key, value]);
    },
  });
  assert.deepEqual(writes, [["zcode-last-agent-provider", "glm"]]);
});

test("missing storage skips the last agent provider write", () => {
  assert.doesNotThrow(() => persistLastAgentProvider("glm", null));
});

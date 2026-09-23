import assert from "node:assert/strict";
import test from "node:test";

import { hash8, toAsciiSlug, toOpencodeModelId, toOpencodeProviderKey } from "@zcode/shared";
import { resolveCustomModelRuntimeModelId } from "../src/bots/botsHostHelpers.js";

test("opencode runtime model ids use the published slug and FNV hash", () => {
  assert.equal(toAsciiSlug("Open Code"), "open-code");
  assert.equal(toAsciiSlug("---"), "provider");
  assert.equal(hash8("zai"), "9495d737");
  assert.equal(toOpencodeProviderKey("zai"), "zai-9495d737");
  assert.equal(toOpencodeModelId("zai", " glm-4 "), "zai-9495d737/glm-4");
  assert.equal(
    resolveCustomModelRuntimeModelId("opencode", { providerId: "zai", modelName: "glm-4" }),
    "zai-9495d737/glm-4",
  );
  assert.equal(
    resolveCustomModelRuntimeModelId("glm", { providerId: "zai", modelName: "glm-4" }),
    "glm-4",
  );
  assert.equal(resolveCustomModelRuntimeModelId("opencode", { providerId: "zai" }), undefined);
  assert.throws(() => toOpencodeProviderKey("  "), /providerId 不能为空/);
  assert.throws(() => toOpencodeModelId("zai", " "), /modelName 不能为空/);
});

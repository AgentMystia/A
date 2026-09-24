import assert from "node:assert/strict";
import test from "node:test";

import { migrateSelection } from "../src/bots/botsNormalize.js";

test("migrateSelection rewrites published builtin model selections", () => {
  assert.deepEqual(
    migrateSelection({
      modelSelection: {
        providerId: "builtin:zai",
        modelId: "glm-5.3",
        options: { reasoningLevel: "high" },
      },
    }),
    {
      providerId: "zai-api",
      modelId: "GLM-5.3",
      options: { reasoningLevel: "high" },
    },
  );
  assert.deepEqual(
    migrateSelection({
      modelSelection: { providerId: "zai-api", modelId: "glm-5.3" },
    }),
    { providerId: "zai-api", modelId: "glm-5.3" },
  );
  assert.equal(
    migrateSelection({
      modelSelection: { providerId: "builtin:not-a-provider", modelId: "glm-5.3" },
    }),
    undefined,
  );
  assert.equal(migrateSelection({ modelSelection: { providerId: "" } }), undefined);
  assert.deepEqual(migrateSelection({ model: "builtin:zai/glm-5.3", thoughtLevel: " low " }), {
    providerId: "zai-api",
    modelId: "GLM-5.3",
    options: { reasoningLevel: "low" },
  });
  assert.deepEqual(migrateSelection({ model: "custom:builtin:bigmodel:glm-4.7" }), {
    providerId: "bigmodel-api",
    modelId: "GLM-4.7",
  });
  assert.deepEqual(migrateSelection({ model: "custom:my-provider:demo" }), {
    providerId: "my-provider",
    modelId: "demo",
  });
  assert.equal(migrateSelection({ model: "builtin:not-a-provider/demo" }), undefined);
  assert.equal(migrateSelection({ model: "glm-5.3" }), undefined);
});

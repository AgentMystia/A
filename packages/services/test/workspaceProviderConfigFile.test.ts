import assert from "node:assert/strict";
import test from "node:test";

import { readWorkspaceProviderConfigFile } from "../src/session/workspaceProviderConfigFile.js";

test("published provider config file is the workspace path and does not exist", () => {
  assert.deepEqual(readWorkspaceProviderConfigFile({ workspacePath: "/work/repo" }), {
    provider: "glm",
    path: "/work/repo",
    exists: false,
  });
});

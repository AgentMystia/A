import assert from "node:assert/strict";
import test from "node:test";

import { getProviderOptionNameMessageIds } from "../src/lib/permissionOptionNameLabels.js";

test("codex session phrases map without widening ZCodeProvider", () => {
  assert.deepEqual(getProviderOptionNameMessageIds("codex", "allow for session"), {
    label: "chat.permission.allowForSession",
  });
  assert.deepEqual(getProviderOptionNameMessageIds("codex", "  Allow   for this   session "), {
    label: "chat.permission.allowForSession",
  });
  assert.equal(getProviderOptionNameMessageIds("glm", "allow for session"), null);
  assert.equal(getProviderOptionNameMessageIds(undefined, "allow for this session"), null);
});

test("glm project phrase and global names stay ahead of the provider table", () => {
  assert.deepEqual(getProviderOptionNameMessageIds("glm", "always allow in this project"), {
    label: "chat.permission.allowForProject",
  });
  assert.deepEqual(getProviderOptionNameMessageIds("codex", "full access"), {
    label: "chat.permission.fullAccess",
    description: "chat.permission.fullAccess.description",
  });
  assert.deepEqual(getProviderOptionNameMessageIds("glm", "always allow in this session"), {
    label: "chat.permission.workflow.allowForSession",
    description: "chat.permission.workflow.allowForSession.description",
  });
});

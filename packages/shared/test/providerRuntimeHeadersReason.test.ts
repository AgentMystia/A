import assert from "node:assert/strict";
import test from "node:test";

import { zcodeProviderRuntimeHeadersRequestParamsSchema } from "../src/zcode-protocol/index.js";

const request = {
  requestId: "request-1",
  sessionId: "session-1",
  workspace: {
    workspacePath: "/tmp/workspace",
    workspaceKey: "workspace-key",
  },
  modelSelection: {
    providerId: "glm",
    modelId: "glm-4.5",
  },
  providerId: "glm",
};

test("provider runtime header requests accept captcha-retry", () => {
  const parsed = zcodeProviderRuntimeHeadersRequestParamsSchema.parse({
    ...request,
    reason: "captcha-retry",
  });
  assert.equal(parsed.reason, "captcha-retry");
  assert.equal(
    zcodeProviderRuntimeHeadersRequestParamsSchema.safeParse({
      ...request,
      reason: "model-request",
    }).success,
    true,
  );
  assert.equal(
    zcodeProviderRuntimeHeadersRequestParamsSchema.safeParse({
      ...request,
      reason: "usage",
    }).success,
    false,
  );
});

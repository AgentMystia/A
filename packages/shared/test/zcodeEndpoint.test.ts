import assert from "node:assert/strict";
import test from "node:test";
import {
  isTrustedCodingPlanWebviewOrigin,
  resolveBigModelApiOrigin,
  resolveRuntimeZCodeEndpointOrigin,
  resolveZCodeEndpointOrigin,
  resolveZaiBusinessBaseUrl,
  resolveZaiOAuthClientId,
  resolveZaiOAuthOrigin,
} from "../src/zcodeEndpoint.js";
import { zcodeTaskMetaSchema } from "../src/validation.js";

test("endpoint origin follows the published production and test channels", () => {
  assert.equal(resolveZCodeEndpointOrigin(), "https://zcode.chatglm.site");
  assert.equal(
    resolveZCodeEndpointOrigin({
      env: "production",
      overrideOrigin: "https://example.test",
    }),
    "https://zcode.z.ai",
  );
  assert.equal(
    resolveZCodeEndpointOrigin({
      env: "production",
      envBaseOrigin: "https://prod.example",
      overrideOrigin: "https://ignored.example",
    }),
    "https://prod.example",
  );
  assert.equal(
    resolveZCodeEndpointOrigin({
      env: "test",
      overrideOrigin: "http://127.0.0.1:4173",
      envBaseOrigin: "https://base.example",
    }),
    "http://127.0.0.1:4173",
  );
  assert.equal(
    resolveRuntimeZCodeEndpointOrigin({
      ZCODE_ENV: "test",
      ZCODE_TEST_BASE_URL: "https://test-base.example",
    }),
    "https://test-base.example",
  );
  assert.equal(
    resolveRuntimeZCodeEndpointOrigin({
      ZCODE_ENV: "production",
      ZCODE_BASE_URL: "https://explicit.example",
      ZCODE_PRODUCTION_BASE_URL: "https://scoped.example",
    }),
    "https://explicit.example",
  );
});

test("bigmodel and zai origins use the published channel defaults", () => {
  assert.equal(resolveBigModelApiOrigin({ ZCODE_ENV: "test" }), "https://dev.bigmodel.cn");
  assert.equal(
    resolveBigModelApiOrigin({
      ZCODE_ENV: "production",
      BIGMODEL_PRODUCTION_API_BASE_URL: "https://bigmodel.example",
    }),
    "https://bigmodel.example",
  );
  assert.equal(
    resolveBigModelApiOrigin({
      ZCODE_ENV: "test",
      BIGMODEL_API_BASE_URL: "https://override.example",
      BIGMODEL_TEST_API_BASE_URL: "https://scoped.example",
    }),
    "https://override.example",
  );
  assert.equal(resolveZaiOAuthOrigin({ ZCODE_ENV: "test" }), "https://zai-test.chatglm.site");
  assert.equal(resolveZaiBusinessBaseUrl({}), "https://api.z.ai");
  assert.equal(resolveZaiBusinessBaseUrl({ ZCODE_ENV: "test" }), "https://api.chatglm.site");
  assert.equal(resolveZaiOAuthClientId({ ZCODE_ENV: "test" }), "client_RzngVdSk8sYsG2_3HzOMdQ");
  assert.equal(
    resolveZaiOAuthClientId({
      ZCODE_ENV: "test",
      ZAI_OAUTH_APP_ID: "from-app",
    }),
    "from-app",
  );
});

test("coding plan webview trusts only the published origins", () => {
  assert.equal(isTrustedCodingPlanWebviewOrigin("https://zcode.z.ai/coding-plan"), true);
  assert.equal(isTrustedCodingPlanWebviewOrigin("https://zcode.chatglm.site"), true);
  assert.equal(isTrustedCodingPlanWebviewOrigin("http://localhost:3000/path"), true);
  assert.equal(isTrustedCodingPlanWebviewOrigin("https://example.test"), false);
  assert.equal(
    isTrustedCodingPlanWebviewOrigin("http://127.0.0.1:4173", { e2eStoreBridgeEnabled: true }),
    true,
  );
});

test("persisted task meta accepts the published repair state", () => {
  const parsed = zcodeTaskMetaSchema.parse({
    taskId: "task",
    traceId: "trace",
    title: "title",
    workspacePath: "/tmp/workspace",
    createdAt: 1,
    updatedAt: 2,
    mode: "acceptEdits",
    repairState: {
      claudeNativeSnapshotAssistantContentVersion: 1,
      codexNativeSnapshotSubagentToolsVersion: 2,
    },
  });
  assert.equal(parsed.mode, "acceptEdits");
  assert.equal(parsed.repairState?.codexNativeSnapshotSubagentToolsVersion, 2);
});

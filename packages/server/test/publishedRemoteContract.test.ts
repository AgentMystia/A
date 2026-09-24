import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRemoteBackend } from "../src/remote/create-backend.js";
import { pickRemoteRuntimeEnv } from "../src/remote/connect.js";
import {
  REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES,
  REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS,
} from "../src/remote/zcodeAgentOfficialPluginAssets.js";

describe("published remote deploy contract", () => {
  it("lists official plugin packages and required assets in deploy order", () => {
    assert.deepEqual(REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES, [
      "android-emulator-plugin",
      "browser-use-plugin",
      "zcode-cua-plugin",
      "documents-plugin",
      "pdf-plugin",
      "presentations-plugin",
      "spreadsheets-plugin",
      "image-search-plugin",
      "ios-simulator-plugin",
      "restore-legacy-sessions-plugin",
      "skill-creator-plugin",
      "plugin-creator-plugin",
      "zcode-guide-plugin",
    ]);
    assert.deepEqual(REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS, [
      ...REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES.map(
        (packageName) => `${packageName}/.zcode-plugin/plugin.json`,
      ),
      "browser-use-plugin/docs/api.json",
      "browser-use-plugin/docs/documents.json",
      "browser-use-plugin/docs/overview.md",
      "browser-use-plugin/docs/recording.md",
      "browser-use-plugin/docs/workflow.md",
      "browser-use-plugin/scripts/browser-client.mjs",
      "browser-use-plugin/skills/control-browser/SKILL.md",
      "browser-use-plugin/skills/web-gui-tester/SKILL.md",
      "image-search-plugin/.mcp.json",
      "documents-plugin/agents/visual-judge.md",
      "documents-plugin/skills/docx/SKILL.md",
      "pdf-plugin/agents/visual-judge.md",
      "pdf-plugin/skills/pdf/SKILL.md",
      "presentations-plugin/agents/visual-judge.md",
      "presentations-plugin/skills/pptx/SKILL.md",
      "spreadsheets-plugin/agents/visual-judge.md",
      "spreadsheets-plugin/skills/xlsx/SKILL.md",
      "zcode-cua-plugin/docs/computer-use.md",
      "zcode-cua-plugin/scripts/computer-use-client.mjs",
      "zcode-cua-plugin/skills/computer-use/SKILL.md",
    ]);
  });

  it("forwards channel-scoped endpoint env and drops unknown keys", () => {
    const picked = pickRemoteRuntimeEnv({
      ZCODE_ENV: " test ",
      ZCODE_TEST_BASE_URL: " https://test.example ",
      ZCODE_PRODUCTION_BASE_URL: "https://prod.example",
      ZAI_TEST_OAUTH_ORIGIN: "https://oauth-test.example",
      ZAI_PRODUCTION_OAUTH_ORIGIN: "https://oauth.example",
      ZAI_TEST_BUSINESS_BASE_URL: "https://biz-test.example",
      ZAI_PRODUCTION_BUSINESS_BASE_URL: "https://biz.example",
      ZAI_TEST_OAUTH_CLIENT_ID: "test-client",
      ZAI_PRODUCTION_OAUTH_CLIENT_ID: "prod-client",
      NOT_A_REMOTE_KEY: "nope",
    });
    assert.equal(picked.ZCODE_ENV, "test");
    assert.equal(picked.ZCODE_TEST_BASE_URL, "https://test.example");
    assert.equal(picked.ZCODE_PRODUCTION_BASE_URL, "https://prod.example");
    assert.equal(picked.ZAI_TEST_OAUTH_ORIGIN, "https://oauth-test.example");
    assert.equal(picked.ZAI_PRODUCTION_OAUTH_ORIGIN, "https://oauth.example");
    assert.equal(picked.ZAI_TEST_BUSINESS_BASE_URL, "https://biz-test.example");
    assert.equal(picked.ZAI_PRODUCTION_BUSINESS_BASE_URL, "https://biz.example");
    assert.equal(picked.ZAI_TEST_OAUTH_CLIENT_ID, "test-client");
    assert.equal(picked.ZAI_PRODUCTION_OAUTH_CLIENT_ID, "prod-client");
    assert.equal("NOT_A_REMOTE_KEY" in picked, false);
  });

  it("rejects a server target before creating a process backend", async () => {
    await assert.rejects(
      createRemoteBackend({ kind: "server", url: "wss://example.invalid" }),
      /server remote target connects to an existing server and has no deploy backend/,
    );
  });
});

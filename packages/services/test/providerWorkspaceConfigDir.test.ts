import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  getAppConfigDir,
  getDataBaseDir,
  getProviderWorkspaceConfigDir,
  getProviderWorkspaceZCodeConfigIsolationDir,
  getWorkspaceHash,
  setDataBaseDir,
} from "../src/paths.js";

test("provider workspace config dirs follow the published layout", () => {
  setDataBaseDir("/tmp/zcode-provider-config");
  try {
    const hash = getWorkspaceHash("/work/app", "remote-ident");
    assert.equal(
      getProviderWorkspaceConfigDir("claude", "/work/app", "remote-ident"),
      join(getAppConfigDir(), "agent-config", "claude", hash),
    );
    assert.equal(
      getProviderWorkspaceZCodeConfigIsolationDir("gemini", "/work/app", "remote-ident"),
      join(getAppConfigDir(), "agent-config", "gemini", hash),
    );
    assert.equal(
      getProviderWorkspaceConfigDir("gemini", "/work/app", "remote-ident"),
      join(getAppConfigDir(), "agent-config", "gemini", hash, ".gemini"),
    );
    assert.equal(
      getProviderWorkspaceConfigDir("glm", "/work/app", "remote-ident"),
      join(getDataBaseDir(), ".zcode", "cli"),
    );
  } finally {
    setDataBaseDir(null);
  }
});

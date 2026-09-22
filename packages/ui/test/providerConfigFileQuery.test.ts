import assert from "node:assert/strict";
import test from "node:test";

import {
  isProviderConfigQueryReady,
  resolveProviderConfigLogScope,
  resolveProviderConfigOpenPath,
  selectProviderConfigTaskService,
} from "../src/lib/providerConfigFileQuery.js";

test("provider config open path uses the parent when the file is missing", () => {
  assert.equal(resolveProviderConfigOpenPath("/work/repo", true), "/work/repo");
  assert.equal(resolveProviderConfigOpenPath("/work/repo", false), "/work");
  assert.equal(resolveProviderConfigOpenPath("/work/repo/", false), "/work");
  assert.equal(resolveProviderConfigOpenPath("/work", false), "/");
  assert.equal(resolveProviderConfigOpenPath("repo", false), "repo");
  assert.equal(resolveProviderConfigOpenPath("C:\\work\\repo", false), "C:\\work");
  assert.equal(resolveProviderConfigOpenPath("C:\\repo", false), "C:\\");
});

test("provider config query waits for a resolved remote session", () => {
  assert.equal(isProviderConfigQueryReady({ remoteSessionId: null }), true);
  assert.equal(
    isProviderConfigQueryReady({ workspaceIdentity: "remote:1", remoteSessionId: null }),
    false,
  );
  assert.equal(
    isProviderConfigQueryReady({ workspaceIdentity: "remote:1", remoteSessionId: "sess" }),
    true,
  );
});

test("provider config service follows the published scope", () => {
  const workspace = { id: "workspace" };
  const base = { id: "base" };
  assert.equal(
    selectProviderConfigTaskService({
      configuredServiceScope: "workspace",
      workspaceZCodeService: workspace,
      baseZCodeService: base,
      remoteSessionId: "sess",
    }),
    workspace,
  );
  assert.equal(
    selectProviderConfigTaskService({
      configuredServiceScope: "base",
      workspaceZCodeService: workspace,
      baseZCodeService: base,
      remoteSessionId: "sess",
    }),
    base,
  );
  assert.equal(
    selectProviderConfigTaskService({
      configuredServiceScope: "base",
      workspaceZCodeService: workspace,
      baseZCodeService: null,
      remoteSessionId: "sess",
    }),
    null,
  );
  assert.equal(
    resolveProviderConfigLogScope({
      configuredServiceScope: "workspace",
      remoteSessionId: "sess",
      workspaceZCodeService: workspace,
      baseZCodeService: base,
    }),
    "remote",
  );
  assert.equal(
    resolveProviderConfigLogScope({
      configuredServiceScope: "base",
      remoteSessionId: "sess",
      workspaceZCodeService: workspace,
      baseZCodeService: base,
    }),
    "base",
  );
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  discoverZCodeProjectConfigPaths,
  isOfficialCuaPluginEnabledForWorkspace,
} from "./helper-official-plugin.js";

const PLUGIN_ID = "computer-use@zcode-plugins-official";

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value));
}

function enabledConfig(pluginOn = true) {
  return {
    features: { mcp: true },
    plugins: { enabled: true, enabledPlugins: { [PLUGIN_ID]: pluginOn } },
  };
}

test("official plugin enablement reads user config and ignores a missing file", () => {
  const root = mkdtempSync(join(tmpdir(), "zcode-cua-plugin-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  mkdirSync(home, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  const env = { HOME: home };

  assert.equal(isOfficialCuaPluginEnabledForWorkspace({ env, workingDirectory: workspace }), false);

  const userConfig = join(home, ".zcode", "cli", "config.json");
  mkdirSync(join(home, ".zcode", "cli"), { recursive: true });
  writeJson(userConfig, enabledConfig(true));
  assert.equal(isOfficialCuaPluginEnabledForWorkspace({ env, workingDirectory: workspace }), true);
});

test("official plugin enablement requires mcp, plugins.enabled, and the plugin id", () => {
  const root = mkdtempSync(join(tmpdir(), "zcode-cua-plugin-"));
  const configPath = join(root, "config.json");
  const options = {
    env: { HOME: join(root, "empty-home") },
    workingDirectory: root,
    userConfigPath: configPath,
  };

  writeJson(configPath, {
    features: { mcp: false },
    plugins: { enabled: true, enabledPlugins: { [PLUGIN_ID]: true } },
  });
  assert.equal(isOfficialCuaPluginEnabledForWorkspace(options), false);

  writeJson(configPath, {
    features: { mcp: true },
    plugins: { enabled: false, enabledPlugins: { [PLUGIN_ID]: true } },
  });
  assert.equal(isOfficialCuaPluginEnabledForWorkspace(options), false);

  writeJson(configPath, enabledConfig(false));
  assert.equal(isOfficialCuaPluginEnabledForWorkspace(options), false);

  writeJson(configPath, {
    features: [],
    plugins: { enabled: true, enabledPlugins: { [PLUGIN_ID]: true } },
  });
  assert.equal(isOfficialCuaPluginEnabledForWorkspace(options), false);

  writeFileSync(configPath, "{");
  assert.equal(isOfficialCuaPluginEnabledForWorkspace(options), false);
});

test("project config walk stops at the worktree and lets the deeper file win", () => {
  const root = mkdtempSync(join(tmpdir(), "zcode-cua-plugin-"));
  const repo = join(root, "repo");
  const nested = join(repo, "nested");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(repo, ".git"), "gitdir: pointer\n");
  writeJson(join(repo, "zcode.json"), enabledConfig(false));
  writeJson(join(nested, "zcode.json"), enabledConfig(true));

  assert.deepEqual(discoverZCodeProjectConfigPaths(nested), [
    join(repo, "zcode.json"),
    join(nested, "zcode.json"),
  ]);
  assert.equal(
    isOfficialCuaPluginEnabledForWorkspace({
      env: { HOME: join(root, "home") },
      workingDirectory: nested,
      userConfigPath: join(root, "missing.json"),
    }),
    true,
  );

  writeJson(join(nested, "zcode.json"), enabledConfig(false));
  assert.equal(
    isOfficialCuaPluginEnabledForWorkspace({
      env: { HOME: join(root, "home") },
      workingDirectory: nested,
      userConfigPath: join(root, "missing.json"),
    }),
    false,
  );
});

test("without a worktree marker only the start directory is searched", () => {
  const root = mkdtempSync(join(tmpdir(), "zcode-cua-plugin-"));
  const parent = join(root, "parent");
  const child = join(parent, "child");
  mkdirSync(child, { recursive: true });
  writeJson(join(parent, "zcode.json"), enabledConfig(true));
  assert.deepEqual(discoverZCodeProjectConfigPaths(child), []);
  assert.equal(
    isOfficialCuaPluginEnabledForWorkspace({
      env: { HOME: join(root, "home") },
      workingDirectory: child,
      userConfigPath: join(root, "missing.json"),
    }),
    false,
  );
});

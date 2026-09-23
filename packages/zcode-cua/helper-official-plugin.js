import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PROJECT_CONFIG_FILES } from "./helper-broker-catalog.js";
import { OFFICIAL_PLUGIN_ID } from "./helper-mcp-server.js";

const WORKTREE_MARKER = ".git";

export function discoverZCodeProjectConfigPaths(cwd) {
  const start = resolve(cwd ?? process.cwd());
  return getProjectConfigDirectories(start).flatMap((directory) =>
    PROJECT_CONFIG_FILES.map((name) => join(directory, name)).filter((path) => existsSync(path)),
  );
}

export function resolveOfficialCuaPluginEnablement(options) {
  return resolveOfficialCuaPluginEnablementState(options).enabled;
}

function resolveOfficialCuaPluginEnablementState(options) {
  let mcpAllowed = true;
  let pluginsEnabled = true;
  let pluginOn = false;
  let configured = false;
  const paths = [
    ...(options.userConfigPath ? [options.userConfigPath] : []),
    ...discoverZCodeProjectConfigPaths(options.workingDirectory),
    ...(options.projectConfigPath ? [options.projectConfigPath] : []),
  ];
  for (const path of paths) {
    const config = readJsonObject(path);
    if (!config) continue;
    if (hasOwn(config, "features")) {
      const features = readObject(config.features);
      if (features) {
        if (hasOwn(features, "mcp")) mcpAllowed = features.mcp === true;
      } else {
        mcpAllowed = false;
      }
    }
    if (hasOwn(config, "plugins")) {
      const plugins = readObject(config.plugins);
      if (!plugins) {
        pluginsEnabled = false;
        pluginOn = false;
        configured = true;
        continue;
      }
      if (hasOwn(plugins, "enabled")) pluginsEnabled = plugins.enabled === true;
      if (hasOwn(plugins, "enabledPlugins")) {
        const enabledPlugins = readObject(plugins.enabledPlugins);
        if (enabledPlugins) {
          if (hasOwn(enabledPlugins, options.pluginId)) {
            pluginOn = enabledPlugins[options.pluginId] === true;
            configured = true;
          }
        } else {
          pluginOn = false;
          configured = true;
        }
      }
    }
  }
  return { configured, enabled: mcpAllowed && pluginsEnabled && pluginOn };
}

function getProjectConfigDirectories(start) {
  const directories = [];
  let current = start;
  for (;;) {
    directories.push(current);
    if (hasWorktreeMarker(current)) return directories.reverse();
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return [start];
}

function hasWorktreeMarker(directory) {
  const marker = join(directory, WORKTREE_MARKER);
  try {
    if (!existsSync(marker)) return false;
    const stats = statSync(marker);
    return stats.isDirectory() || stats.isFile();
  } catch {
    return false;
  }
}

function readJsonObject(path) {
  try {
    return readObject(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
}

function readObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function isOfficialCuaPluginEnabledForWorkspace(options = {}) {
  const home = (options.env ?? process.env).HOME?.trim() || homedir();
  return resolveOfficialCuaPluginEnablement({
    pluginId: OFFICIAL_PLUGIN_ID,
    workingDirectory: options.workingDirectory,
    projectConfigPath: options.projectConfigPath,
    userConfigPath: options.userConfigPath ?? join(home, ".zcode", "cli", "config.json"),
  });
}

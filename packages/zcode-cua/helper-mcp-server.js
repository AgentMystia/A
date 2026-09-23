import { BROKER_SOCKET_ENV } from "./broker.js";
import { resolveZCodeCuaBrokerRefreshMarkerPath } from "./helper-refresh-marker.js";

const PLUGIN_ID_ENV = "ZCODE_PLUGIN_ID";
const OFFICIAL_PLUGIN_ID = "computer-use@zcode-plugins-official";
const PLUGIN_AUTHORITY_ENV = "ZCODE_CUA_PLUGIN_AUTHORITY";
const COMPUTER_USE_SERVER_NAME = "computer-use";
const OFFICIAL_SERVER_NAME = "plugin:computer-use:computer-use";
const PERMISSION_BROKER_SOCKET_FLAG = "--permission-broker-socket";
const PACKAGE_SPEC_ENV = "ZCODE_CUA_PACKAGE_SPEC";
const REFRESH_MARKER_ENV = "ZCODE_CUA_PERMISSION_BROKER_REFRESH_MARKER";

function zcodeCuaArgLeaf(value) {
  return (
    value
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? value
  );
}

function matchesZCodeCuaSpec(value) {
  const normalized = value.replace(/_/g, "-");
  return (
    normalized === "zcode-cua" ||
    normalized.startsWith("zcode-cua[") ||
    normalized.startsWith("zcode-cua@") ||
    normalized.startsWith("zcode-cua==") ||
    normalized.startsWith("zcode-cua.")
  );
}

function hasZCodeCuaPackageBoundary(value) {
  return (
    value === "zcode-cua" ||
    value.startsWith("zcode-cua[") ||
    value.startsWith("zcode-cua@") ||
    value.startsWith("zcode-cua==") ||
    value.startsWith("zcode-cua.")
  );
}

function matchesZCodeCuaSpecBroad(value) {
  const normalized = value.toLowerCase().replace(/_/g, "-");
  if (hasZCodeCuaPackageBoundary(normalized)) return true;
  return hasZCodeCuaPackageBoundary(normalized.replace(/([a-z0-9])\.(?=[a-z0-9])/g, "$1-"));
}

function isZCodeCuaMcpServerName(name, pluginId) {
  const normalized = name.trim().toLowerCase();
  return normalized === COMPUTER_USE_SERVER_NAME
    ? true
    : normalized === OFFICIAL_SERVER_NAME && pluginId?.trim().toLowerCase() === OFFICIAL_PLUGIN_ID;
}

function isZCodeCuaMcpCommand(command) {
  return matchesZCodeCuaSpec(command) || matchesZCodeCuaSpec(zcodeCuaArgLeaf(command));
}

function isZCodeCuaMcpPackageArg(value) {
  return matchesZCodeCuaSpec(value) || matchesZCodeCuaSpec(zcodeCuaArgLeaf(value));
}

function resolvesToZCodeCuaPackage(server) {
  const candidates = [];
  const push = (value) => {
    if (!value) return;
    candidates.push(value);
    const leaf = zcodeCuaArgLeaf(value);
    if (leaf !== value) candidates.push(leaf);
  };
  push(server.command);
  if (server.args) {
    for (const arg of server.args) push(arg);
  }
  push(server.packageSpec);
  return candidates.some(matchesZCodeCuaSpecBroad);
}

export function normalizeAgentMcpArgs(args) {
  return Array.isArray(args) ? args.filter((arg) => typeof arg === "string") : [];
}

export function normalizeAgentMcpEnv(env) {
  return Array.isArray(env)
    ? env.filter(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.name === "string" &&
          typeof entry.value === "string",
      )
    : [];
}

function upsertEnv(env, name, value) {
  const next = env.filter((entry) => entry.name !== name).map((entry) => ({ ...entry }));
  next.push({ name, value });
  return next;
}

function optionArgsBeforeTerminator(args) {
  const index = args.indexOf("--");
  return index === -1 ? args : args.slice(0, index);
}

function hasSeparateOptionValue(value) {
  return value !== undefined && value !== "--" && !value.startsWith("--");
}

export function upsertFlag(args, flag, value) {
  const terminator = args.indexOf("--");
  const before = optionArgsBeforeTerminator(args);
  const after = terminator === -1 ? [] : args.slice(terminator);
  const kept = [];
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] === flag) {
      if (hasSeparateOptionValue(before[index + 1])) index += 1;
      continue;
    }
    if (!before[index]?.startsWith(`${flag}=`)) kept.push(before[index]);
  }
  args.splice(0, args.length, ...kept, flag, value, ...after);
}

export function asCommandServer(server) {
  return typeof server !== "object" ||
    server === null ||
    !("command" in server) ||
    typeof server.command !== "string"
    ? null
    : server;
}

export function isPotentialZCodeCuaAgentMcpServer(server) {
  const commandServer = asCommandServer(server);
  if (!commandServer) return false;
  const name = "name" in server && typeof server.name === "string" ? server.name : "";
  if (name.trim().toLowerCase().startsWith("plugin:")) {
    const env = normalizeAgentMcpEnv(commandServer.env);
    const pluginId = env.find((entry) => entry.name === PLUGIN_ID_ENV)?.value;
    if (isZCodeCuaMcpServerName(name, pluginId)) return true;
    const packageSpec = env.find((entry) => entry.name === PACKAGE_SPEC_ENV)?.value;
    if (packageSpec && isZCodeCuaMcpPackageArg(packageSpec)) return true;
  } else if (name && isZCodeCuaMcpServerName(name)) return true;
  return isZCodeCuaMcpCommand(commandServer.command)
    ? true
    : normalizeAgentMcpArgs(commandServer.args).some(isZCodeCuaMcpPackageArg);
}

export function isOfficialZCodeCuaPluginCandidate(server) {
  const commandServer = asCommandServer(server);
  if (
    !commandServer ||
    ("name" in server && typeof server.name === "string" ? server.name : "")
      .trim()
      .toLowerCase() !== OFFICIAL_SERVER_NAME
  ) {
    return false;
  }
  return (
    normalizeAgentMcpEnv(commandServer.env)
      .find((entry) => entry.name === PLUGIN_ID_ENV)
      ?.value.trim()
      .toLowerCase() === OFFICIAL_PLUGIN_ID
  );
}

export function isAuthorizedOfficialZCodeCuaPluginServer(server, pluginAuthority) {
  const authority = pluginAuthority?.trim();
  if (!authority || !isOfficialZCodeCuaPluginCandidate(server)) return false;
  return normalizeAgentMcpEnv(server.env).some(
    (entry) => entry.name === PLUGIN_AUTHORITY_ENV && entry.value === authority,
  );
}

function isUnbrokeredZCodeCuaAgentMcpServer(server) {
  const commandServer = asCommandServer(server);
  if (!commandServer) return false;
  const env = normalizeAgentMcpEnv(commandServer.env);
  const packageSpec = env.find((entry) => entry.name === PACKAGE_SPEC_ENV)?.value;
  return resolvesToZCodeCuaPackage({
    command: commandServer.command,
    args: normalizeAgentMcpArgs(commandServer.args),
    packageSpec,
  })
    ? !env.find((entry) => entry.name === BROKER_SOCKET_ENV)?.value?.trim()
    : false;
}

export function omitUnbrokeredZCodeCuaAgentMcpServers(servers) {
  if (!servers || servers.length === 0) return servers;
  const kept = servers.filter((server) => !isUnbrokeredZCodeCuaAgentMcpServer(server));
  return kept.length === servers.length ? servers : kept;
}

function injectPermissionBrokerAgentMcpServer(server, transport) {
  if (!isAuthorizedOfficialZCodeCuaPluginServer(server, transport.pluginAuthority)) return server;
  if (!transport.socketPath || transport.socketPath.trim().length === 0) {
    throw new Error("injectPermissionBrokerAgentMcpServers requires a non-empty socketPath");
  }
  const args = normalizeAgentMcpArgs(server.args);
  upsertFlag(args, PERMISSION_BROKER_SOCKET_FLAG, transport.socketPath);
  const marker = resolveZCodeCuaBrokerRefreshMarkerPath(transport.socketPath);
  const env = upsertEnv(
    upsertEnv(normalizeAgentMcpEnv(server.env), BROKER_SOCKET_ENV, transport.socketPath),
    REFRESH_MARKER_ENV,
    marker,
  );
  return { ...server, args, env };
}

export function injectPermissionBrokerAgentMcpServers(servers, transport) {
  if (!servers || servers.length === 0 || !transport.pluginAuthority?.trim()) return servers;
  const injected = servers.map((server) => injectPermissionBrokerAgentMcpServer(server, transport));
  return injected.some((server, index) => server !== servers[index]) ? injected : servers;
}

export function injectPermissionBrokerConfig(server, transport) {
  if (!transport.socketPath || transport.socketPath.trim().length === 0) {
    throw new Error("injectPermissionBrokerConfig requires a non-empty socketPath");
  }
  const args = [...(server.args ?? [])];
  upsertFlag(args, PERMISSION_BROKER_SOCKET_FLAG, transport.socketPath);
  const marker = resolveZCodeCuaBrokerRefreshMarkerPath(transport.socketPath);
  return {
    ...server,
    args,
    env: {
      ...server.env,
      [BROKER_SOCKET_ENV]: transport.socketPath,
      [REFRESH_MARKER_ENV]: marker,
    },
  };
}

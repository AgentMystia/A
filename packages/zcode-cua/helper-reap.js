import { realpathSync } from "node:fs";

import { brokerRuntimeDir } from "./helper-broker-runtime.js";
import {
  addCanonicalPathAliases,
  defaultIsProcessAlive,
  defaultListProcesses,
  extractFlagValue,
  messageOf,
  rowLooksLikeHelperProcess,
  standaloneHelperExecutablePaths,
} from "./helper-process-evidence.js";

const MAX_REAP_PER_RUN = 32;

function isPathWithinDir(path, directory) {
  if (path === directory) return true;
  const prefix = directory.endsWith("/") ? directory : `${directory}/`;
  return path.startsWith(prefix);
}

export function extractHelperOwnerPid(command) {
  const raw = extractFlagValue(command, "--launcher-pid");
  if (raw !== null) {
    const pid = Number(raw);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}

export function isLikelyZCodeDevOwnerCommand(command) {
  return /(?:^|\s|\/)(?:node|electron)(?:\s|$)/u.test(command)
    ? command.includes("/z-code/") ||
        command.includes("/zcode/") ||
        command.includes("packages/services") ||
        command.includes("apps/zcode") ||
        command.includes("dev.zcode")
    : false;
}

export function isLikelyZCodeOwnerCommand(command) {
  const normalized = command.replaceAll("\\", "/").toLowerCase();
  if (normalized.includes("zcode cua helper") || normalized.includes("zcode-cua")) return false;
  if (
    /\bzcode-host(?:-|$)/u.test(normalized) ||
    /\bzcode-main(?:\s|$|-)/u.test(normalized) ||
    normalized.includes("/zcode.app/contents/macos/") ||
    normalized.includes("zcode.app/contents/macos/") ||
    /\bzcode(?:\s|$)/u.test(normalized)
  ) {
    return true;
  }
  return isLikelyZCodeDevOwnerCommand(normalized);
}

export function createDefaultOwnerEvidenceProvider(options) {
  const { getRows, currentUid, selfPid, isProcessAlive, deadPids } = options;
  return (pid) => {
    if (pid === selfPid) return { state: "alive", identity: "zcode-owner", reason: "self" };
    if (!isProcessAlive(pid)) {
      deadPids.add(pid);
      return { state: "dead", reason: "pid not alive" };
    }
    if (!deadPids.has(pid)) {
      return { state: "alive", identity: "zcode-owner", reason: "live owner; spared by default" };
    }
    const row = getRows().find(
      (candidate) => candidate.pid === pid && candidate.uid === currentUid,
    );
    if (row && !isLikelyZCodeOwnerCommand(row.command)) {
      return {
        state: "alive",
        identity: "unrelated",
        command: row.command,
        reason: "pid observed dead earlier is alive again with a non-ZCode command line",
      };
    }
    return {
      state: "alive",
      identity: "zcode-owner",
      command: row?.command,
      reason: "pid reused after death; command still matches ZCode",
    };
  };
}

export function isReapableOrphanHelper(row, context) {
  if (
    row.ppid !== 1 ||
    row.pid === context.selfPid ||
    !rowLooksLikeHelperProcess(row, context.currentUid, context.executablePaths)
  ) {
    return false;
  }
  const socket = extractFlagValue(row.command, "--socket");
  if (!socket || !isPathWithinDir(socket, context.runtimeDir)) return false;
  const ownerPid = extractHelperOwnerPid(row.command);
  if (ownerPid === null) return false;
  const evidence = context.ownerEvidenceProvider(ownerPid);
  return evidence.state === "dead" || evidence.identity === "unrelated";
}

export function reapOrphanedHelpers(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const logger = options.logger;
  const result = { scanned: 0, reaped: [] };
  if (platform !== "darwin") return result;
  const currentUid =
    options.currentUid ?? (typeof process.getuid === "function" ? process.getuid() : null);
  if (currentUid == null) return result;
  const selfPid = options.selfPid ?? process.pid;
  const maxReap = options.maxReap ?? MAX_REAP_PER_RUN;
  const listProcesses = options.listProcesses ?? defaultListProcesses;
  const killProcess = options.killProcess ?? ((pid) => process.kill(pid, "SIGTERM"));
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const canonicalizePath = options.canonicalizePath ?? realpathSync.native;
  let rows;
  try {
    rows = listProcesses();
  } catch (error) {
    logger?.warn(undefined, `cua helper reaper: process listing failed: ${messageOf(error)}`);
    return result;
  }
  result.scanned = rows.length;
  const deadPids = new Set();
  let currentRows = rows;
  function getRows() {
    return currentRows;
  }
  const ownerEvidenceProvider =
    options.ownerEvidenceProvider ??
    createDefaultOwnerEvidenceProvider({
      getRows,
      currentUid,
      selfPid,
      isProcessAlive,
      deadPids,
    });
  const context = {
    currentUid,
    selfPid,
    executablePaths: addCanonicalPathAliases(
      standaloneHelperExecutablePaths(env),
      canonicalizePath,
    ),
    runtimeDir: brokerRuntimeDir(env),
    ownerEvidenceProvider,
  };
  for (const row of rows) {
    if (result.reaped.length >= maxReap) {
      logger?.warn(undefined, `cua helper reaper: hit per-run cap (${maxReap}); stopping`);
      break;
    }
    currentRows = rows;
    if (!isReapableOrphanHelper(row, context)) continue;
    let refreshed;
    try {
      refreshed = listProcesses();
    } catch (error) {
      logger?.warn(
        undefined,
        `cua helper reaper: pre-SIGTERM recheck failed for pid ${row.pid}: ${messageOf(error)}`,
      );
      continue;
    }
    const again = refreshed.find((candidate) => candidate.pid === row.pid) ?? null;
    if (!again) continue;
    currentRows = refreshed;
    if (!isReapableOrphanHelper(again, context)) continue;
    try {
      killProcess(again.pid);
      result.reaped.push(again.pid);
    } catch (error) {
      logger?.warn(
        undefined,
        `cua helper reaper: SIGTERM of orphaned Helper pid ${again.pid} failed: ${messageOf(error)}`,
      );
    }
  }
  if (result.reaped.length > 0) {
    logger?.info(
      undefined,
      `cua helper reaper: SIGTERM'd ${result.reaped.length} orphaned Helper(s): ${result.reaped.join(", ")}`,
    );
  }
  return result;
}

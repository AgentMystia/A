import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";

export { realpathSync };

import { DEV_HELPER_APP_NAME, HELPER_APP_NAME } from "./broker-helper-constants.js";
import {
  recognizedCuaHelperInstallRoots,
  standaloneHelperCandidatePaths,
} from "./helper-install-plan.js";
import { HELPER_TOOLS } from "./helper-tools.js";

// 发布包把单次回收上限和 ps 参数写成同一条 var。异步 listProcesses 另有一份字面量。
export const MAX_REAP_PER_RUN = 32;
const PS_ARGS = ["-awwxo", "pid=,ppid=,uid=,command="];

export function standaloneHelperExecutablePaths(env = process.env) {
  // 顶层 replace 会在 main / scheduler 摇掉函数后留下 `\.app$`。发布包在三个函数里各写一次。
  const executableName = HELPER_APP_NAME.replace(/\.app$/u, "");
  const standalone = standaloneHelperCandidatePaths(env);
  const rooted = recognizedCuaHelperInstallRoots(env).flatMap((root) => [
    join(root, HELPER_APP_NAME),
    join(root, DEV_HELPER_APP_NAME),
  ]);
  return [...new Set([...standalone, ...rooted])].map((appPath) =>
    join(appPath, "Contents", "MacOS", executableName),
  );
}

export function parsePsProcessRows(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
    if (!match) continue;
    const [, pid, ppid, uid, command] = match;
    if (pid === undefined || ppid === undefined || uid === undefined || command === undefined)
      continue;
    rows.push({ pid: Number(pid), ppid: Number(ppid), uid: Number(uid), command });
  }
  return rows;
}

export function defaultListProcesses() {
  return parsePsProcessRows(execFileSync(HELPER_TOOLS.ps, PS_ARGS, { encoding: "utf8" }));
}

export function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

export function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function addCanonicalPathAliases(paths, canonicalize) {
  const aliases = new Set(paths);
  for (const path of paths) {
    try {
      aliases.add(canonicalize(path));
    } catch {
      // 个别候选解析失败时仍保留原始路径。
    }
  }
  return [...aliases];
}

function commandStartsWithExactExecutable(command, executable) {
  return command === executable || command.startsWith(`${executable} `);
}

export function extractFlagValue(command, flag) {
  const parts = command.split(/\s+/u);
  const index = parts.indexOf(flag);
  return index < 0 || index + 1 >= parts.length ? null : (parts[index + 1] ?? null);
}

function commandHasExactFlagValue(command, flag, value) {
  const needle = ` ${flag} ${value}`;
  let index = command.indexOf(needle);
  while (index >= 0) {
    const end = index + needle.length;
    if (end === command.length || /\s/u.test(command[end])) return true;
    index = command.indexOf(needle, index + 1);
  }
  return false;
}

function commandMayStartWithHelperBundleExecutable(command) {
  if (!command.startsWith("/")) return false;
  const marker = `/Contents/MacOS/${HELPER_APP_NAME.replace(/\.app$/u, "")}`;
  let index = command.indexOf(marker);
  while (index > 0) {
    const end = index + marker.length;
    if (end === command.length || /\s/u.test(command[end])) return true;
    index = command.indexOf(marker, index + 1);
  }
  return false;
}

export function helperExecutablePathForApp(appPath) {
  return join(appPath, "Contents", "MacOS", HELPER_APP_NAME.replace(/\.app$/u, ""));
}

export function createDefaultHelperPidEvidenceProvider(options = {}) {
  const platform = options.platform ?? process.platform;
  const currentUid =
    options.currentUid ?? (typeof process.getuid === "function" ? process.getuid() : null);
  const list = options.listProcesses ?? defaultListProcesses;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const canonicalize = options.canonicalizePath ?? realpathSync.native;
  const stableExecutables = addCanonicalPathAliases(
    standaloneHelperExecutablePaths(options.env ?? process.env),
    canonicalize,
  );
  const logger = options.logger;
  return (pid, context) => {
    if (platform !== "darwin" || currentUid === null) {
      return { state: "helper", reason: "non-darwin / no uid; identity recheck unavailable" };
    }
    let rows;
    try {
      rows = list();
    } catch (error) {
      logger?.warn(
        undefined,
        `cua helper kill-path: process listing failed for pid ${pid} (${messageOf(error)}); skipping SIGTERM as a pid-reuse precaution`,
      );
      return { state: "unknown", reason: "process listing failed" };
    }
    const row = rows.find((candidate) => candidate.pid === pid);
    if (!row) {
      return isProcessAlive(pid)
        ? { state: "unknown", reason: "pid alive but absent from ps snapshot" }
        : { state: "dead", reason: "pid not alive" };
    }
    const executables = context?.helperAppPath
      ? addCanonicalPathAliases(
          [helperExecutablePathForApp(context.helperAppPath), ...stableExecutables],
          canonicalize,
        )
      : stableExecutables;
    const matched = executables.find((executable) =>
      commandStartsWithExactExecutable(row.command, executable),
    );
    if (
      matched &&
      (!context?.socketPath ||
        commandHasExactFlagValue(row.command, "--socket", context.socketPath))
    ) {
      return { state: "helper", reason: "ps command matches Helper executable path" };
    }
    if (matched && context?.socketPath) {
      const socketArg = extractFlagValue(row.command, "--socket");
      if (
        socketArg === null ||
        (context.socketPath.startsWith(socketArg) && row.command.trimEnd().endsWith(socketArg))
      ) {
        return {
          state: "unknown",
          reason: "Helper argv is incomplete; exact random socket cannot be verified",
          command: row.command,
        };
      }
      return {
        state: "unrelated",
        reason: "pid now belongs to a Helper launched for a different random socket",
        command: row.command,
      };
    }
    if (
      context?.socketPath &&
      commandHasExactFlagValue(row.command, "--socket", context.socketPath) &&
      commandMayStartWithHelperBundleExecutable(row.command)
    ) {
      return {
        state: "unknown",
        reason:
          "Helper-shaped argv and exact random socket match, but canonical executable identity cannot be proven",
        command: row.command,
      };
    }
    const trimmed = row.command.trimEnd();
    if (trimmed.length > 0 && executables.some((executable) => executable.startsWith(trimmed))) {
      return {
        state: "unknown",
        reason: "ps command may be a truncated Helper executable path",
        command: row.command,
      };
    }
    return {
      state: "unrelated",
      reason: context?.socketPath
        ? "pid no longer matches the Helper executable and random socket"
        : "pid reused by non-Helper process",
      command: row.command,
    };
  };
}

export function rowLooksLikeHelperProcess(row, uid, executables, socketPath) {
  if (
    row.uid !== uid ||
    !executables.some((executable) => commandStartsWithExactExecutable(row.command, executable))
  ) {
    return false;
  }
  return socketPath ? commandHasExactFlagValue(row.command, "--socket", socketPath) : true;
}

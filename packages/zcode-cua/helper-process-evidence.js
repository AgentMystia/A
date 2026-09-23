import { execFile, execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { DEV_HELPER_APP_NAME, HELPER_APP_NAME } from "./broker-helper-constants.js";
import {
  recognizedCuaHelperInstallRoots,
  resolveCuaHelperInstallRoot,
  resolveHelperAppName,
} from "./helper-install-plan.js";
import { HELPER_TOOLS } from "./helper-tools.js";

const PS_ARGS = ["-awwxo", "pid=,ppid=,uid=,command="];
const HELPER_EXECUTABLE_NAME = HELPER_APP_NAME.replace(/\.app$/u, "");

export function standaloneHelperCandidatePaths(env = process.env) {
  const root = resolveCuaHelperInstallRoot(env);
  return root ? [join(root, resolveHelperAppName(env))] : [];
}

export function productHelperCandidatePaths(env = process.env) {
  return standaloneHelperCandidatePaths(env);
}

export function resolveHelperAppPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

export function helperExecutablePathForApp(appPath) {
  return join(appPath, "Contents", "MacOS", HELPER_EXECUTABLE_NAME);
}

export function standaloneHelperExecutablePaths(env = process.env) {
  const standalone = standaloneHelperCandidatePaths(env);
  const rooted = recognizedCuaHelperInstallRoots(env).flatMap((root) => [
    join(root, HELPER_APP_NAME),
    join(root, DEV_HELPER_APP_NAME),
  ]);
  return [...new Set([...standalone, ...rooted])].map((appPath) =>
    helperExecutablePathForApp(appPath),
  );
}

function parsePsProcessRows(text) {
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

export function listProcesses() {
  return execFileText(HELPER_TOOLS.ps, PS_ARGS).then(({ stdout }) => parsePsProcessRows(stdout));
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
  const marker = `/Contents/MacOS/${HELPER_EXECUTABLE_NAME}`;
  let index = command.indexOf(marker);
  while (index > 0) {
    const end = index + marker.length;
    if (end === command.length || /\s/u.test(command[end])) return true;
    index = command.indexOf(marker, index + 1);
  }
  return false;
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

export function listUnixSocketOwnerPids(socketPath) {
  return new Promise((resolveOwners, rejectOwners) => {
    const args = ["-n", "-P", "-Fpcfn", "--", socketPath];
    execFile(HELPER_TOOLS.lsof, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      const pids = [...stdout.matchAll(/^p([0-9]+)$/gmu)]
        .map((match) => Number(match[1]))
        .filter((pid) => Number.isInteger(pid) && pid > 1);
      if (!error) {
        resolveOwners(pids);
        return;
      }
      const code = error.code;
      if (
        (code === 1 || code === "1") &&
        pids.length === 0 &&
        (!existsSync(socketPath) || stderr.trim().length === 0)
      ) {
        resolveOwners([]);
        return;
      }
      rejectOwners(
        new Error(
          `${HELPER_TOOLS.lsof} ${args.join(" ")} failed: ${error.message}${stderr ? `\n${stderr}` : ""}`,
        ),
      );
    });
  });
}

function execFileText(command, args) {
  return new Promise((resolveText, rejectText) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        rejectText(
          new Error(
            `${command} ${args.join(" ")} failed: ${messageOf(error)}${stderr ? ` ${stderr}` : ""}`,
          ),
        );
        return;
      }
      resolveText({ stdout, stderr });
    });
  });
}

const discoverDependencies = {
  listUnixSocketOwnerPids,
  listProcesses,
  currentUid: () => (typeof process.getuid === "function" ? process.getuid() : null),
  canonicalize: realpathSync,
};

export async function discoverCuaHelperLaunchProcesses(
  target,
  dependencies = discoverDependencies,
) {
  const uid = dependencies.currentUid();
  if (uid === null) return { state: "unknown", pids: [], detail: "current uid is unavailable" };
  let socketOwners = [];
  let socketError = null;
  try {
    socketOwners = [...new Set(await dependencies.listUnixSocketOwnerPids(target.socketPath))];
  } catch (error) {
    socketError = messageOf(error).split(target.socketPath).join("<socket>");
  }
  let rows;
  try {
    rows = await dependencies.listProcesses();
  } catch (error) {
    const detail = messageOf(error).split(target.socketPath).join("<socket>");
    return { state: "unknown", pids: [], detail: `process inspection failed: ${detail}` };
  }
  const apps = [target.helperAppPath];
  try {
    apps.push(dependencies.canonicalize(target.helperAppPath));
  } catch {
    // 安装路径本身仍参与比对。
  }
  const executables = [...new Set(apps.map(helperExecutablePathForApp))];
  const observed = rows
    .filter((row) => rowLooksLikeHelperProcess(row, uid, executables, target.socketPath))
    .map((row) => row.pid);
  if (observed.length > 0) {
    const owners = new Set(socketOwners);
    return {
      state: "observed",
      pids: [...new Set(observed)].sort(
        (left, right) => Number(owners.has(right)) - Number(owners.has(left)),
      ),
      ...(socketError ? { detail: `socket inspection failed: ${socketError}` } : {}),
    };
  }
  if (socketOwners.length > 0) {
    return {
      state: "unknown",
      pids: [],
      detail: "random Helper socket still has an owner whose exact launch argv is unverified",
    };
  }
  return socketError
    ? { state: "unknown", pids: [], detail: `socket inspection failed: ${socketError}` }
    : { state: "absent", pids: [] };
}

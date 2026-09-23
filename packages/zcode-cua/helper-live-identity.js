import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { CuaHelperError } from "./broker.js";
import { DEV_CUA_HELPER_BUNDLE_ID } from "./broker-helper-constants.js";
import { execFileText } from "./helper-exec-file-text.js";
import {
  isCuaLocalDevelopmentRuntime,
  EXPECTED_CUA_HELPER_TEAM_ID,
} from "./helper-install-plan.js";
import {
  helperExecutablePathForApp,
  parsePsProcessRows,
  rowLooksLikeHelperProcess,
} from "./helper-process-evidence.js";
import { HELPER_TOOLS } from "./helper-tools.js";

const SAFE_CODE_SIGNING_TOKEN = /^[A-Za-z0-9.-]+$/;

export class CuaHelperLiveProcessIdentityError extends CuaHelperError {
  constructor(message, observedSocketOwnerPid = null, options) {
    super("verification_failed", message, options);
    this.name = "CuaHelperLiveProcessIdentityError";
    this.observedSocketOwnerPid = observedSocketOwnerPid;
  }
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

export function listProcesses() {
  return execFileText(HELPER_TOOLS.ps, ["-awwxo", "pid=,ppid=,uid=,command="]).then(({ stdout }) =>
    parsePsProcessRows(stdout),
  );
}

const defaultLiveIdentityDependencies = {
  listUnixSocketOwnerPids,
  async verifyProcessCodeSignature(pid, requirement) {
    await execFileText(HELPER_TOOLS.codesign, [
      "--verify",
      "--strict",
      `-R=${requirement}`,
      String(pid),
    ]);
  },
  async readProcessHostingPaths(pid) {
    const { stdout, stderr } = await execFileText(HELPER_TOOLS.codesign, [
      "--hosting",
      String(pid),
    ]);
    return `${stdout}\n${stderr}`
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => isAbsolute(line));
  },
  canonicalize: realpathSync,
};

export function resolveCuaHelperLiveCodeRequirement(input) {
  const bundleId = input.expectedBundleId.trim();
  if (!SAFE_CODE_SIGNING_TOKEN.test(bundleId)) {
    throw new CuaHelperLiveProcessIdentityError(
      "ZCode Computer Use live verification received an unsafe bundle identifier",
    );
  }
  if (input.allowAdHocLocalDev) {
    if (bundleId !== DEV_CUA_HELPER_BUNDLE_ID) {
      throw new CuaHelperLiveProcessIdentityError(
        "Ad-hoc Computer Use Helper live verification is restricted to the isolated dev bundle identifier",
      );
    }
    return `identifier "${bundleId}"`;
  }
  const env = input.env ?? process.env;
  const teamId =
    (isCuaLocalDevelopmentRuntime(env) ? env.ZCODE_CUA_HELPER_TEAM_ID?.trim() : undefined) ||
    EXPECTED_CUA_HELPER_TEAM_ID;
  if (!SAFE_CODE_SIGNING_TOKEN.test(teamId)) {
    throw new CuaHelperLiveProcessIdentityError(
      "ZCode Computer Use live verification received an unsafe TeamIdentifier",
    );
  }
  return `anchor apple generic and identifier "${bundleId}" and certificate leaf[subject.OU] = "${teamId}"`;
}

function isHostedInside(contentsMacos, candidate, canonicalize) {
  try {
    const realCandidate = canonicalize(candidate);
    const relativePath = relative(contentsMacos, realCandidate);
    return (
      relativePath.length > 0 &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(relativePath)
    );
  } catch {
    return false;
  }
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
    socketError = (error instanceof Error ? error.message : String(error))
      .split(target.socketPath)
      .join("<socket>");
  }
  let rows;
  try {
    rows = await dependencies.listProcesses();
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error))
      .split(target.socketPath)
      .join("<socket>");
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

export async function verifyCuaHelperLiveProcessIdentity(
  input,
  dependencies = defaultLiveIdentityDependencies,
) {
  if (
    input.reportedPid === null ||
    !Number.isInteger(input.reportedPid) ||
    input.reportedPid <= 1
  ) {
    throw new CuaHelperLiveProcessIdentityError(
      "ZCode Computer Use broker_info did not report a valid process id",
    );
  }
  let owners;
  try {
    owners = [...new Set(await dependencies.listUnixSocketOwnerPids(input.socketPath))];
  } catch (error) {
    throw new CuaHelperLiveProcessIdentityError(
      "Could not resolve the live process listening on the ZCode Computer Use socket",
      null,
      { cause: error },
    );
  }
  if (owners.length !== 1) {
    throw new CuaHelperLiveProcessIdentityError(
      `ZCode Computer Use socket has ${owners.length} live owners; expected exactly one`,
      owners.length === 1 ? owners[0] : null,
    );
  }
  const owner = owners[0];
  if (owner !== input.reportedPid) {
    throw new CuaHelperLiveProcessIdentityError(
      `ZCode Computer Use broker_info pid ${input.reportedPid} does not own its broker socket`,
      owner,
    );
  }
  try {
    await dependencies.verifyProcessCodeSignature(
      owner,
      resolveCuaHelperLiveCodeRequirement(input),
    );
  } catch (error) {
    throw new CuaHelperLiveProcessIdentityError(
      "The live ZCode Computer Use process does not satisfy the expected code-signing identity",
      owner,
      { cause: error },
    );
  }
  let hostingPaths;
  try {
    hostingPaths = await dependencies.readProcessHostingPaths(owner);
  } catch (error) {
    throw new CuaHelperLiveProcessIdentityError(
      "Could not resolve the live ZCode Computer Use process hosting path",
      owner,
      { cause: error },
    );
  }
  const contentsMacos = resolve(
    dependencies.canonicalize(input.helperAppPath),
    "Contents",
    "MacOS",
  );
  if (
    !hostingPaths.some((path) => isHostedInside(contentsMacos, path, dependencies.canonicalize))
  ) {
    throw new CuaHelperLiveProcessIdentityError(
      "The live ZCode Computer Use process is not hosted by the verified Helper bundle",
      owner,
    );
  }
  let confirmed;
  try {
    confirmed = [...new Set(await dependencies.listUnixSocketOwnerPids(input.socketPath))];
  } catch (error) {
    throw new CuaHelperLiveProcessIdentityError(
      "Could not re-confirm the live ZCode Computer Use socket owner after code-signature verification",
      owner,
      { cause: error },
    );
  }
  if (confirmed.length !== 1 || confirmed[0] !== owner) {
    throw new CuaHelperLiveProcessIdentityError(
      "ZCode Computer Use socket ownership changed during live process verification",
      confirmed.length === 1 ? confirmed[0] : null,
    );
  }
  return { pid: owner };
}

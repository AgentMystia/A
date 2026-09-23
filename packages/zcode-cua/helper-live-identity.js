import { execFile } from "node:child_process";
import { isAbsolute, join, relative } from "node:path";
import { realpathSync } from "node:fs";

import { CuaHelperError } from "./broker.js";
import { DEV_CUA_HELPER_BUNDLE_ID } from "./broker-helper-constants.js";
import {
  isCuaLocalDevelopmentRuntime,
  EXPECTED_CUA_HELPER_TEAM_ID,
} from "./helper-install-plan.js";
import { listUnixSocketOwnerPids } from "./helper-process-evidence.js";
import { HELPER_TOOLS } from "./helper-tools.js";

const SAFE_CODE_SIGNING_TOKEN = /^[A-Za-z0-9.-]+$/;

export class CuaHelperLiveProcessIdentityError extends CuaHelperError {
  constructor(message, observedSocketOwnerPid = null, options) {
    super("verification_failed", message, options);
    this.name = "CuaHelperLiveProcessIdentityError";
    this.observedSocketOwnerPid = observedSocketOwnerPid;
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
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
  const contentsMacos = join(dependencies.canonicalize(input.helperAppPath), "Contents", "MacOS");
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

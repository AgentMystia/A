import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { CuaHelperError } from "./broker.js";
import { HELPER_APP_NAME } from "./broker-helper-constants.js";
import { defaultDownloadFile, redactHelperDownloadUrl } from "./helper-download.js";
import { formatErrorMessage } from "./helper-exec-file-text.js";
import {
  defaultClearQuarantine,
  defaultExtractZip,
  findHelperAppRecursively,
} from "./helper-install-archive.js";
import { resolveCuaHelperInstallPlan } from "./helper-install-plan.js";
import { acquireMacOSCuaHelperInstallLease } from "./helper-install-lease.js";
import {
  defaultCuaHelperVerifierDependencies,
  verifyCuaHelperBundle,
} from "./helper-install-verify.js";

const META_NAME = ".zcode-cua-helper-meta.json";
const LOCAL_DEV_PAYLOAD_FILES = [["Contents", "Info.plist"]];
const installsInFlight = new Map();

async function clearHelperQuarantine(appPath, context) {
  // 发布包用 catch，不用 try。同步抛出不会被吞掉。
  await context.dependencies.clearQuarantine(appPath).catch((error) => {
    context.logger?.warn(
      undefined,
      `cua helper installed and verified, but quarantine cleanup failed: ${formatErrorMessage(error)}`,
    );
  });
}

async function localDevPayloadTreeChanged(left, right) {
  const readEntries = async (directory) => {
    try {
      return await readdir(directory, { withFileTypes: true });
    } catch {
      return null;
    }
  };
  const [leftEntries, rightEntries] = await Promise.all([readEntries(left), readEntries(right)]);
  if (leftEntries === null || rightEntries === null) return leftEntries !== rightEntries;
  const leftByName = new Map(leftEntries.map((entry) => [entry.name, entry]));
  const rightByName = new Map(rightEntries.map((entry) => [entry.name, entry]));
  if (leftByName.size !== rightByName.size) return true;
  for (const [name, rightEntry] of rightByName) {
    const leftEntry = leftByName.get(name);
    if (!leftEntry) return true;
    const leftPath = join(left, name);
    const rightPath = join(right, name);
    if (
      rightEntry.isDirectory() !== leftEntry.isDirectory() ||
      rightEntry.isSymbolicLink() !== leftEntry.isSymbolicLink()
    ) {
      return true;
    }
    if (rightEntry.isDirectory()) {
      if (await localDevPayloadTreeChanged(leftPath, rightPath)) return true;
      continue;
    }
    if (rightEntry.isSymbolicLink()) {
      const [leftLink, rightLink] = await Promise.all([readlink(leftPath), readlink(rightPath)]);
      if (leftLink !== rightLink) return true;
      continue;
    }
    const [leftBytes, rightBytes] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
    if (!leftBytes.equals(rightBytes)) return true;
  }
  return false;
}

export async function shouldRefreshLocalDevBundledHelper(plan, executableName) {
  if (!plan.allowUnsignedLocalDev || plan.source.kind !== "bundled" || !executableName)
    return false;
  const relativePaths = [["Contents", "MacOS", executableName], ...LOCAL_DEV_PAYLOAD_FILES];
  for (const relativePath of relativePaths) {
    const installed = join(plan.appPath, ...relativePath);
    const bundled = join(plan.source.appPath, ...relativePath);
    try {
      const [installedBytes, bundledBytes] = await Promise.all([
        readFile(installed),
        readFile(bundled),
      ]);
      if (!installedBytes.equals(bundledBytes)) return true;
    } catch {
      return true;
    }
  }
  return localDevPayloadTreeChanged(
    join(plan.appPath, "Contents", "Resources"),
    join(plan.source.appPath, "Contents", "Resources"),
  );
}

export async function stageBundledHelperApp(appPath, stagingDir) {
  if (!existsSync(appPath)) {
    throw new CuaHelperError(
      "helper_missing",
      `Bundled ZCode Computer Use.app is missing at ${appPath}`,
    );
  }
  const destination = join(stagingDir, HELPER_APP_NAME);
  try {
    await cp(appPath, destination, {
      recursive: true,
      errorOnExist: true,
      preserveTimestamps: true,
    });
  } catch (error) {
    throw new CuaHelperError(
      "install_failed",
      `Failed to stage bundled ZCode Computer Use.app: ${formatErrorMessage(error)}`,
      { cause: error },
    );
  }
  return destination;
}

export async function stageDownloadedHelperApp(context, stagingDir, source) {
  const { plan, logger, dependencies } = context;
  logger?.info(
    undefined,
    `installing local-development cua helper ${plan.version} ${plan.platformKey} from ${redactHelperDownloadUrl(source.url)}`,
  );
  const archivePath = join(stagingDir, source.fileName);
  const extractDir = join(stagingDir, "extract");
  try {
    await dependencies.downloadFile(source.url, archivePath);
  } catch (error) {
    const redacted = redactHelperDownloadUrl(source.url);
    const message = formatErrorMessage(error).split(source.url).join(redacted);
    throw new CuaHelperError(
      "download_failed",
      `Failed to download ZCode Computer Use from ${redacted}: ${message}`,
      { cause: error },
    );
  }
  await mkdir(extractDir, { recursive: true });
  try {
    await dependencies.extractZip(archivePath, extractDir);
  } catch (error) {
    throw new CuaHelperError(
      "install_failed",
      `Failed to extract ZCode Computer Use archive ${archivePath}: ${formatErrorMessage(error)}`,
      { cause: error },
    );
  }
  const appPath = await findHelperAppRecursively(extractDir);
  if (!appPath) {
    throw new CuaHelperError(
      "install_failed",
      `ZCode Computer Use archive did not contain ${HELPER_APP_NAME}`,
    );
  }
  return appPath;
}

export async function promoteHelperApp(stagedApp, destination) {
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const backup = join(parent, `.${HELPER_APP_NAME}.backup-${process.pid}-${Date.now()}`);
  let movedAside = false;
  if (existsSync(destination)) {
    await rm(backup, { recursive: true, force: true });
    await rename(destination, backup);
    movedAside = true;
  }
  try {
    await rename(stagedApp, destination);
  } catch (error) {
    if (movedAside) {
      await rm(destination, { recursive: true, force: true });
      await rename(backup, destination);
    }
    throw new CuaHelperError(
      "install_failed",
      `Failed to promote ${HELPER_APP_NAME} into ${destination}: ${formatErrorMessage(error)}`,
      { cause: error },
    );
  }
  if (movedAside) await rm(backup, { recursive: true, force: true });
}

export async function writeInstallMeta(plan, verified) {
  await writeFile(
    join(plan.installRoot, META_NAME),
    `${JSON.stringify(
      {
        provider: "zcode-cua-helper",
        version: plan.version,
        buildId: verified.bundleInfo.buildId,
        platform: plan.platformKey,
        source:
          plan.source.kind === "bundled"
            ? "bundled:zcode-app"
            : redactHelperDownloadUrl(plan.source.url),
        bundleId: verified.bundleInfo.bundleId,
        displayName: basename(plan.appPath, ".app"),
        teamIdentifier: verified.codesign?.teamIdentifier ?? null,
        verificationMode: verified.mode,
        releaseEligible: verified.releaseEligible,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function ensureCuaHelperInstalledUnderLease(context, lease) {
  const { plan, logger, dependencies } = context;
  lease.assertHeld();
  if (existsSync(plan.appPath)) {
    try {
      const verified = await verifyCuaHelperBundle(plan.appPath, plan, dependencies);
      if (await shouldRefreshLocalDevBundledHelper(plan, verified.bundleInfo.executableName)) {
        logger?.info(
          undefined,
          `local bundled cua helper payload changed; replacing ${plan.appPath}`,
        );
      } else {
        lease.assertHeld();
        await clearHelperQuarantine(plan.appPath, context);
        try {
          await writeInstallMeta(plan, verified);
        } catch (error) {
          logger?.warn(
            undefined,
            `verified installed cua helper but failed to refresh install metadata: ${formatErrorMessage(error)}`,
          );
        }
        logger?.info(
          undefined,
          plan.allowUnsignedLocalDev
            ? `local unsigned cua helper ${plan.version} already installed at ${plan.appPath}`
            : `cua helper ${plan.version} already installed at ${plan.appPath}`,
        );
        return plan.appPath;
      }
    } catch (error) {
      if (plan.allowUnsignedLocalDev && plan.source.kind !== "bundled") {
        throw new CuaHelperError(
          "verification_failed",
          `Local unsigned ZCode Computer Use.app failed dev verification: ${formatErrorMessage(error)}. Rebuild and reinstall it at ${plan.appPath}, or unset ZCODE_CUA_HELPER_ALLOW_UNSIGNED_LOCAL for the signed release path.`,
          { cause: error },
        );
      }
      logger?.warn(
        undefined,
        `installed cua helper is not usable, reinstalling: ${formatErrorMessage(error)}`,
      );
    }
  }
  if (plan.allowUnsignedLocalDev && plan.source.kind !== "bundled") {
    throw new CuaHelperError(
      "helper_missing",
      `Local unsigned ZCode Computer Use.app is not installed at ${plan.appPath}. Build the Helper locally and copy it there, or unset ZCODE_CUA_HELPER_ALLOW_UNSIGNED_LOCAL for the signed release installer.`,
    );
  }
  const staging = await mkdtemp(join(plan.installRoot, ".cua-helper-install-"));
  try {
    const staged =
      plan.source.kind === "bundled"
        ? await stageBundledHelperApp(plan.source.appPath, staging)
        : await stageDownloadedHelperApp(context, staging, plan.source);
    const verified = await verifyCuaHelperBundle(staged, plan, dependencies);
    lease.assertHeld();
    await promoteHelperApp(staged, plan.appPath);
    lease.assertHeld();
    await clearHelperQuarantine(plan.appPath, context);
    try {
      await writeInstallMeta(plan, verified);
    } catch (error) {
      logger?.warn(
        undefined,
        `installed cua helper but failed to write install metadata: ${formatErrorMessage(error)}`,
      );
    }
    logger?.info(undefined, `installed cua helper ${plan.version} at ${plan.appPath}`);
    return plan.appPath;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function ensureCuaHelperInstalledSingleFlight(context) {
  const key = resolve(context.plan.appPath);
  const existing = installsInFlight.get(key);
  if (existing) return existing;
  const flight = (async () => {
    await mkdir(context.plan.installRoot, { recursive: true, mode: 0o700 });
    const lease = await context.dependencies.acquireInstallLease(context.plan);
    try {
      lease.assertHeld();
      return await ensureCuaHelperInstalledUnderLease(context, lease);
    } finally {
      await lease.release();
    }
  })().finally(() => {
    if (installsInFlight.get(key) === flight) installsInFlight.delete(key);
  });
  installsInFlight.set(key, flight);
  return flight;
}

export function createCuaHelperInstaller(options = {}) {
  const context = {
    plan:
      options.plan ??
      resolveCuaHelperInstallPlan({
        env: options.env,
        bundledAppPath: options.bundledAppPath,
      }),
    logger: options.logger,
    dependencies: {
      downloadFile: defaultDownloadFile,
      extractZip: defaultExtractZip,
      clearQuarantine: defaultClearQuarantine,
      acquireInstallLease: acquireMacOSCuaHelperInstallLease,
      ...defaultCuaHelperVerifierDependencies,
      ...options.dependencies,
    },
  };
  return {
    ensureInstalled() {
      return ensureCuaHelperInstalledSingleFlight(context);
    },
    async verifyInstalled(appPath, verifyOptions) {
      await verifyCuaHelperBundle(appPath, context.plan, context.dependencies, verifyOptions);
    },
  };
}

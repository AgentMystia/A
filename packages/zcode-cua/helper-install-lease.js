import { constants, fstatSync, lstatSync } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";

import { CuaHelperError } from "./broker.js";
import { formatErrorMessage } from "./helper-exec-file-text.js";

const LOCK_NAME = ".zcode-cua-helper-install.lock";
const LOCK_WAIT_MS = 120_000;
const LOCK_RETRY_MS = 50;
const O_EXLOCK = 32;

export class HelperInstallLockContendedError extends Error {
  constructor(lockPath) {
    super(`ZCode Computer Use install lock is held by another owner: ${lockPath}`);
    this.name = "HelperInstallLockContendedError";
  }
}

export function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

export function assertOwnedSecureDirectory(directory, stats) {
  const uid = currentUid();
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    (uid !== undefined && stats.uid !== uid) ||
    (Number(stats.mode) & 18) !== 0
  ) {
    throw new CuaHelperError(
      "install_failed",
      `Refusing insecure ZCode Computer Use install-lock directory ${directory}; it must be a real owner-controlled directory without group/other write access`,
    );
  }
}

export function assertOwnedSecureLockFile(lockPath, stats) {
  const uid = currentUid();
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.nlink !== 1 ||
    (uid !== undefined && stats.uid !== uid) ||
    (Number(stats.mode) & 511) !== 384
  ) {
    throw new CuaHelperError(
      "install_failed",
      `Refusing insecure ZCode Computer Use install lock ${lockPath}; it must be a real owner-only regular file with exactly one link`,
    );
  }
}

export function isLockContendedError(error) {
  const code = error?.code;
  return code === "EAGAIN" || code === "EWOULDBLOCK";
}

export async function prepareHelperInstallLockFile(directory) {
  let rootReal;
  try {
    rootReal = await realpath(directory);
  } catch (error) {
    throw new CuaHelperError(
      "install_failed",
      `Cannot resolve ZCode Computer Use install-lock directory ${directory}: ${formatErrorMessage(error)}`,
      { cause: error },
    );
  }
  assertOwnedSecureDirectory(directory, await lstat(directory));
  const lockPath = join(directory, LOCK_NAME);
  const flags = constants.O_RDWR | constants.O_NOFOLLOW | O_EXLOCK | constants.O_NONBLOCK;
  let handle;
  try {
    handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | flags, 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw new CuaHelperError(
        "install_failed",
        `Cannot create ZCode Computer Use install lock ${lockPath}: ${formatErrorMessage(error)}`,
        { cause: error },
      );
    }
    try {
      assertOwnedSecureLockFile(lockPath, await lstat(lockPath));
      handle = await open(lockPath, flags);
    } catch (openError) {
      if (isLockContendedError(openError)) throw new HelperInstallLockContendedError(lockPath);
      throw new CuaHelperError(
        "install_failed",
        `Refusing unsafe ZCode Computer Use install lock ${lockPath}: ${formatErrorMessage(openError)}`,
        { cause: openError },
      );
    }
  }
  try {
    const [openedStat, listedStat, resolved] = await Promise.all([
      handle.stat(),
      lstat(lockPath),
      realpath(lockPath),
    ]);
    assertOwnedSecureLockFile(lockPath, openedStat);
    assertOwnedSecureLockFile(lockPath, listedStat);
    if (
      resolved !== join(rootReal, LOCK_NAME) ||
      openedStat.dev !== listedStat.dev ||
      openedStat.ino !== listedStat.ino
    ) {
      throw new CuaHelperError(
        "install_failed",
        `ZCode Computer Use install lock changed while it was being opened: ${lockPath}`,
      );
    }
    return { lockPath, identity: { device: listedStat.dev, inode: listedStat.ino }, handle };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export function assertInstallLeaseDescriptorHeld(lease, released) {
  if (released) {
    throw new CuaHelperError(
      "install_failed",
      "ZCode Computer Use install lease has already been released",
    );
  }
  try {
    const opened = fstatSync(lease.handle.fd);
    const listed = lstatSync(lease.lockPath);
    assertOwnedSecureLockFile(lease.lockPath, opened);
    assertOwnedSecureLockFile(lease.lockPath, listed);
    if (
      opened.dev !== lease.identity.device ||
      opened.ino !== lease.identity.inode ||
      listed.dev !== lease.identity.device ||
      listed.ino !== lease.identity.inode
    ) {
      throw new CuaHelperError(
        "install_failed",
        `ZCode Computer Use install lock changed while its lease was held: ${lease.lockPath}`,
      );
    }
  } catch (error) {
    if (error instanceof CuaHelperError) throw error;
    throw new CuaHelperError(
      "install_failed",
      `ZCode Computer Use install lease is no longer verifiable: ${formatErrorMessage(error)}`,
      { cause: error },
    );
  }
}

export function installLeaseAbortedError() {
  return new CuaHelperError(
    "install_failed",
    "ZCode Computer Use install lease acquisition was aborted",
  );
}

export function delayWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(installLeaseAbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function acquireLockedInstallLockFile(directory, waitTimeoutMs, signal) {
  const deadline = Date.now() + waitTimeoutMs;
  for (;;) {
    if (signal?.aborted) throw installLeaseAbortedError();
    try {
      return await prepareHelperInstallLockFile(directory);
    } catch (error) {
      if (!(error instanceof HelperInstallLockContendedError)) throw error;
      if (Date.now() >= deadline) {
        throw new CuaHelperError(
          "install_failed",
          `Failed to acquire ZCode Computer Use install lease: timed out after ${waitTimeoutMs}ms; ${error.message}`,
          { cause: error },
        );
      }
      await delayWithAbort(LOCK_RETRY_MS, signal);
    }
  }
}

export async function acquireMacOSCuaHelperInstallLease(plan, options = {}) {
  if (process.platform !== "darwin") {
    throw new CuaHelperError(
      "install_failed",
      `ZCode Computer Use install lease requires macOS (O_EXLOCK); got ${process.platform}`,
    );
  }
  if (options.signal?.aborted) throw installLeaseAbortedError();
  const waitTimeoutMs =
    typeof options.waitTimeoutMs === "number" &&
    Number.isFinite(options.waitTimeoutMs) &&
    options.waitTimeoutMs > 0
      ? options.waitTimeoutMs
      : LOCK_WAIT_MS;
  const lease = await acquireLockedInstallLockFile(plan.installRoot, waitTimeoutMs, options.signal);
  try {
    await options.faultInjection?.afterLockFilePrepared?.(lease.lockPath);
    const listed = await lstat(lease.lockPath);
    assertOwnedSecureLockFile(lease.lockPath, listed);
    if (listed.dev !== lease.identity.device || listed.ino !== lease.identity.inode) {
      throw new CuaHelperError(
        "install_failed",
        `ZCode Computer Use install lock changed before its lease was used: ${lease.lockPath}`,
      );
    }
  } catch (error) {
    await lease.handle.close().catch(() => {});
    if (error instanceof CuaHelperError) throw error;
    throw new CuaHelperError(
      "install_failed",
      `Failed to acquire ZCode Computer Use install lease: ${formatErrorMessage(error)}`,
      { cause: error },
    );
  }
  let released = false;
  let releasePromise;
  return {
    assertHeld() {
      assertInstallLeaseDescriptorHeld(lease, released);
    },
    release() {
      releasePromise ??= (async () => {
        if (!released) {
          await lease.handle.close();
          released = true;
        }
      })();
      return releasePromise;
    },
  };
}

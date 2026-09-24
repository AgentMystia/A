import { readdir, readlink, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { CuaHelperError } from "./broker.js";
import { HELPER_APP_NAME } from "./broker-helper-constants.js";
import { execFileText, formatErrorMessage } from "./helper-exec-file-text.js";
import { HELPER_TOOLS } from "./helper-tools.js";

export function isUnsafeZipEntryName(name) {
  return (
    name.length === 0 ||
    name.includes("\0") ||
    name.startsWith("/") ||
    name.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(name) ||
    name.split(/[\\/]/u).some((part) => part === "..")
  );
}

export async function assertSafeZipArchiveEntries(archivePath) {
  const { stdout } = await execFileText(HELPER_TOOLS.unzip, ["-Z1", archivePath]);
  const entries = stdout
    .split("\n")
    .map((entry) => entry.replace(/\r$/u, ""))
    .filter((entry) => entry.length > 0);
  for (const entry of entries) {
    if (isUnsafeZipEntryName(entry)) {
      throw new CuaHelperError(
        "install_failed",
        `refusing to extract Computer Use Helper archive: unsafe zip entry path ${JSON.stringify(entry)}`,
      );
    }
  }
}

export async function assertNoSymlinkEscape(root) {
  const realRoot = await realpath(root);
  const withinRoot = (candidate) =>
    candidate === realRoot || candidate.startsWith(`${realRoot}${sep}`);
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        const link = await readlink(entryPath);
        const resolved = resolve(current, link);
        if (!withinRoot(resolved)) {
          throw new CuaHelperError(
            "install_failed",
            `refusing extracted Computer Use Helper: symlink escapes staging (${entryPath} -> ${link})`,
          );
        }
      } else if (entry.isDirectory()) {
        pending.push(entryPath);
      }
    }
  }
}

export async function defaultExtractZip(archivePath, destination) {
  await assertSafeZipArchiveEntries(archivePath);
  await execFileText(HELPER_TOOLS.ditto, ["-x", "-k", archivePath, destination]);
  await assertNoSymlinkEscape(destination);
}

export async function defaultClearQuarantine(appPath) {
  // 发布包压缩后是 `platform === "darwin" && await xattr.catch(...)`。
  // if 会收成这条表达式；提前 return 不会。
  if (process.platform === "darwin") {
    await execFileText(HELPER_TOOLS.xattr, ["-dr", "com.apple.quarantine", appPath]).catch(
      (error) => {
        const message = formatErrorMessage(error);
        if (!/No such xattr|No such file|No such file or directory|not found/iu.test(message)) {
          throw error;
        }
      },
    );
  }
}

export async function findHelperAppRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name === HELPER_APP_NAME) return entryPath;
    const nested = await findHelperAppRecursively(entryPath);
    if (nested) return nested;
  }
  return null;
}

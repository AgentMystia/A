import { lstatSync, readdirSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

const ATTESTATION_ENTRY_CAP = 4096;

function statSignature(path) {
  const info = statSync(path, { bigint: true });
  return `${info.dev}:${info.ino}:${info.mode}:${info.ctimeNs}:${info.size}`;
}

function lstatSignature(path) {
  const info = lstatSync(path, { bigint: true });
  return `${info.dev}:${info.ino}:${info.mode}:${info.ctimeNs}:${info.size}`;
}

function isOutsideContents(relativePath) {
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(relativePath)
  );
}

export function captureCuaHelperBundleAttestation(appPath) {
  const contents = join(appPath, "Contents");
  const contentsRoot = realpathSync(contents);
  const pending = [{ absolutePath: contents, relativePath: "Contents" }];
  const entries = [`app:${statSignature(appPath)}`];
  while (pending.length > 0) {
    if (entries.length >= ATTESTATION_ENTRY_CAP) {
      throw new Error(
        `ZCode Computer Use bundle exceeds ${ATTESTATION_ENTRY_CAP} attestation entries`,
      );
    }
    const current = pending.shift();
    const info = lstatSync(current.absolutePath, { bigint: true });
    if (info.isSymbolicLink()) {
      const target = readlinkSync(current.absolutePath);
      const linkParent = realpathSync(current.absolutePath);
      const fromRoot = relative(contentsRoot, linkParent);
      if (isOutsideContents(fromRoot)) {
        throw new Error(
          `ZCode Computer Use contains an out-of-bundle symlink: ${current.relativePath} -> ${target}`,
        );
      }
      entries.push(
        `${current.relativePath}:symlink:${lstatSignature(current.absolutePath)}:${target}:${statSignature(current.absolutePath)}`,
      );
      continue;
    }
    entries.push(`${current.relativePath}:${statSignature(current.absolutePath)}`);
    if (info.isDirectory()) {
      for (const name of readdirSync(current.absolutePath).sort()) {
        pending.push({
          absolutePath: join(current.absolutePath, name),
          relativePath: `${current.relativePath}/${name}`,
        });
      }
    }
  }
  return entries.join("|");
}

export function assertCuaHelperBundleAttestationUnchanged(appPath, attestation) {
  let current;
  try {
    current = captureCuaHelperBundleAttestation(appPath);
  } catch (error) {
    throw new Error(
      `ZCode Computer Use changed or became unreadable after verification: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (current !== attestation) {
    throw new Error("ZCode Computer Use changed after signature verification");
  }
}

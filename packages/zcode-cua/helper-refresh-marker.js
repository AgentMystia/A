import { randomBytes } from "node:crypto";
import { chmod, rename, rm, writeFile } from "node:fs/promises";

const DEFAULT_REFRESH_DEADLINE_MS = 30_000;
const MAX_REFRESH_DEADLINE_MS = 120_000;
const activeMarkers = new Map();

export function resolveZCodeCuaBrokerRefreshMarkerPath(socketPath) {
  const trimmed = socketPath.trim();
  if (!trimmed) throw new Error("CUA broker refresh marker requires a non-empty socket path");
  return `${trimmed}.permission-refresh.json`;
}

export function cuaBrokerRefreshMarkerPath(socketPath) {
  return resolveZCodeCuaBrokerRefreshMarkerPath(socketPath);
}

export async function publishCuaBrokerRefreshMarker(socketPath, options = {}) {
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? DEFAULT_REFRESH_DEADLINE_MS;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > MAX_REFRESH_DEADLINE_MS) {
    throw new Error(
      `CUA broker refresh marker deadline must be within 1-${MAX_REFRESH_DEADLINE_MS}ms, got ${deadlineMs}`,
    );
  }
  const path = cuaBrokerRefreshMarkerPath(socketPath);
  if (activeMarkers.has(path)) {
    throw new Error("CUA broker permission refresh is already active for this transport");
  }
  const id = Symbol("cua-broker-refresh-marker");
  activeMarkers.set(path, { id });
  const started = now();
  const deadlineEpochMs = started + deadlineMs;
  if (
    !Number.isSafeInteger(started) ||
    !Number.isSafeInteger(deadlineEpochMs) ||
    deadlineEpochMs <= started
  ) {
    activeMarkers.delete(path);
    throw new Error("CUA broker refresh marker clock produced an invalid deadline");
  }
  const body = `${JSON.stringify({ schema: 1, kind: "permission_refresh", deadlineEpochMs })}\n`;
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  try {
    await writeFile(temporary, body, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    if (activeMarkers.get(path)?.id === id) activeMarkers.delete(path);
    throw error;
  }
  return {
    path,
    deadlineEpochMs,
    async complete() {
      if (activeMarkers.get(path)?.id !== id) return;
      let failure;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await rm(path, { force: true });
          failure = undefined;
          break;
        } catch (error) {
          failure = error;
          if (attempt < 2) await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
        }
      }
      if (failure) throw failure;
      if (activeMarkers.get(path)?.id === id) activeMarkers.delete(path);
    },
  };
}

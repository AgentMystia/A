import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { CuaHelperError } from "./broker.js";

const DOWNLOAD_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_ENV = "ZCODE_CUA_HELPER_DOWNLOAD_TIMEOUT_MS";
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES_ENV = "ZCODE_CUA_HELPER_MAX_DOWNLOAD_BYTES";

export function resolveDownloadTimeoutMs(env) {
  const raw = env[DOWNLOAD_TIMEOUT_ENV]?.trim();
  if (!raw) return DOWNLOAD_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DOWNLOAD_TIMEOUT_MS;
}

export function resolveMaxDownloadBytes(env = process.env) {
  const raw = env[MAX_DOWNLOAD_BYTES_ENV]?.trim();
  if (!raw) return MAX_DOWNLOAD_BYTES;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : MAX_DOWNLOAD_BYTES;
}

export function createDownloadSizeLimiter(maxBytes) {
  let seen = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      seen += chunk.length;
      if (seen > maxBytes) {
        callback(new Error(`ZCode Computer Use download exceeded max size ${maxBytes} bytes`));
        return;
      }
      callback(null, chunk);
    },
  });
}

export function redactHelperDownloadUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    const path = (url.split(/[?#]/u)[0] ?? url).split("/");
    return path[path.length - 1] || "<redacted-url>";
  }
}

export function assertSafeHelperDownloadUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new CuaHelperError(
      "download_failed",
      `invalid ZCode Computer Use download URL: ${redactHelperDownloadUrl(url)}`,
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new CuaHelperError(
      "download_failed",
      `refusing to download ZCode Computer Use over unsupported scheme "${parsed.protocol}" (only http/https are allowed)`,
    );
  }
}

export async function defaultDownloadFile(url, destination) {
  assertSafeHelperDownloadUrl(url);
  const timeoutMs = resolveDownloadTimeoutMs(process.env);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`download timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    if (!response.body) throw new Error("empty response body");
    const maxBytes = resolveMaxDownloadBytes(process.env);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(
        `ZCode Computer Use download declares ${declared} bytes, exceeding max ${maxBytes}`,
      );
    }
    await pipeline(
      Readable.fromWeb(response.body),
      createDownloadSizeLimiter(maxBytes),
      createWriteStream(destination),
    );
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`download timed out after ${timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

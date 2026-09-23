import { createConnection } from "node:net";
import { join } from "node:path";

// 发布包把方法表和恢复码跟 CuaHelperError 放在同一条加载链上，main/host/scheduler 都有。
import "./helper-broker-catalog.js";

import {
  brokerRuntimeDir,
  pruneStaleBrokerSockets,
  randomBrokerSocketSuffix,
  STABLE_BROKER_SOCKET_NAME,
  WINDOWS_HELPER_PIPE_PREFIX,
} from "./helper-broker-runtime.js";

export const BROKER_SOCKET_ENV = "ZCODE_CUA_PERMISSION_BROKER_SOCKET";
export const BROKER_UNAVAILABLE_ENV = "ZCODE_CUA_PERMISSION_BROKER_UNAVAILABLE";

export class BrokerError extends Error {
  constructor(message, options = {}) {
    super(message ?? "Computer Use broker is unavailable.");
    this.name = "BrokerError";
    this.code = options.code ?? "unavailable";
    if (options.details !== undefined) this.details = options.details;
  }
}

export class CuaHelperError extends Error {
  constructor(code, message, options) {
    super(message);
    this.name = "CuaHelperError";
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export function isCuaHelperError(value) {
  return value instanceof CuaHelperError;
}

const brokerErrorFactory = (code) => (message, details) =>
  new BrokerError(message ?? code, { code, details });

export const notAuthorized = brokerErrorFactory("not_authorized");
export const notSelectable = brokerErrorFactory("not_selectable");
export const notSettable = brokerErrorFactory("not_settable");
export const elementUnavailable = brokerErrorFactory("element_unavailable");
export const actionUnavailable = brokerErrorFactory("action_unavailable");
export const foregroundRequired = brokerErrorFactory("foreground_required");

class BrokerAuthRejectedError extends Error {
  constructor(message) {
    super(message);
    this.name = "BrokerAuthRejectedError";
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 发布包 host chunk 里的简单交换，和 PermissionBrokerClient 不是同一条协议。
 * 先发 id 0 的空 authenticate，再发 id 1 的业务方法。坏 JSON 行跳过。
 */
export function brokerExchange({ socketPath, method, params, timeoutMs }) {
  const sanitize = (value) => value.split(socketPath).join("<socket>");
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    let authenticated = false;
    let finished = false;
    const finish = (settle) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      settle();
    };
    socket.on("close", () =>
      finish(() => reject(new Error(sanitize("broker connection closed before reply")))),
    );
    socket.on("error", (error) => finish(() => reject(new Error(sanitize(error.message)))));
    socket.setTimeout(timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id: 0, method: "authenticate", params: {} })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim()) {
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            newline = buffer.indexOf("\n");
            continue;
          }
          if (authenticated) {
            finish(() => resolve(message));
            return;
          }
          authenticated = true;
          if (message.ok !== true) {
            finish(() => reject(new BrokerAuthRejectedError("broker auth rejected")));
            return;
          }
          socket.write(`${JSON.stringify({ id: 1, method, params })}\n`);
        }
        newline = buffer.indexOf("\n");
      }
    });
    socket.on("timeout", () =>
      finish(() => reject(new Error(sanitize("broker exchange timed out")))),
    );
  });
}

export async function callBrokerMethod(args) {
  const { socketPath, method, params = {}, timeoutMs = 2_000 } = args;
  const sanitize = (value) => value.split(socketPath).join("<socket>");
  let response;
  try {
    response = await brokerExchange({ socketPath, method, params, timeoutMs });
  } catch (error) {
    if (error instanceof BrokerAuthRejectedError) {
      throw new CuaHelperError("auth_failed", sanitize("broker auth rejected"));
    }
    throw error;
  }
  if (response.ok === true) return response.result;
  const error = response.error;
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "broker error";
  throw new Error(sanitize(message));
}

export async function probeHelperHealth(socketPath, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const perTryTimeoutMs = options.perTryTimeoutMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (;;) {
    const tryTimeout = Math.max(1, Math.min(perTryTimeoutMs, deadline - Date.now()));
    try {
      const response = await brokerExchange({
        socketPath,
        method: "broker_info",
        params: {},
        timeoutMs: tryTimeout,
      });
      if (response.ok === true) {
        const result = response.result ?? {};
        return {
          bundleId: typeof result.bundle_id === "string" ? result.bundle_id : null,
          pid: typeof result.pid === "number" ? result.pid : null,
        };
      }
    } catch (error) {
      if (error instanceof BrokerAuthRejectedError) {
        throw new CuaHelperError(
          "auth_failed",
          "ZCode Computer Use rejected this process as a broker peer (code-signature gate). ZCode and the helper may be version-mismatched; reinstall or repair the helper component.",
        );
      }
      lastError = error;
    }
    if (Date.now() >= deadline) break;
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
  const detail =
    lastError instanceof Error ? lastError.message : String(lastError ?? "no connection");
  throw new CuaHelperError(
    "health_timeout",
    `ZCode Computer Use did not become ready within ${timeoutMs}ms. It may have failed to launch or lacks required permissions (${detail}).`,
  );
}

// 发布包把稳定探测 socket 和每次启动的随机 socket 分开。设置页探测走前者。
export function mintBrokerSocketPath(options = {}) {
  const env = options.env ?? process.env;
  if (process.platform === "win32") {
    return WINDOWS_HELPER_PIPE_PREFIX + randomBrokerSocketSuffix();
  }
  const dir = options.dir ?? brokerRuntimeDir(env);
  pruneStaleBrokerSockets(dir);
  return join(dir, `broker-${randomBrokerSocketSuffix()}.sock`);
}

export function resolveBrokerSocketPath(options = {}) {
  const env = options.env ?? process.env;
  const configured = env[BROKER_SOCKET_ENV];
  if (typeof configured === "string" && configured.trim().length > 0) return configured;
  if (process.platform === "win32") return `${WINDOWS_HELPER_PIPE_PREFIX}default`;
  if (options.dir) return join(options.dir, STABLE_BROKER_SOCKET_NAME);
  return join(brokerRuntimeDir(env), STABLE_BROKER_SOCKET_NAME);
}

export function parseRequestLine(_line) {
  return undefined;
}

export function okResponse(result) {
  return { ok: true, result };
}

export function errorResponse(message, options = {}) {
  return {
    ok: false,
    error: { message, ...(options.code ? { code: options.code } : {}) },
  };
}

export function errorResponseFromException(error) {
  return errorResponse(error instanceof Error ? error.message : String(error));
}

export function serializeResponse(response) {
  return `${JSON.stringify(response)}\n`;
}

export async function dispatchRequest(_backend, _request) {
  throw new CuaHelperError("helper_unavailable", "Computer Use is not available in this build.");
}

export async function handleRequestLine(_backend, _line) {
  throw new CuaHelperError("helper_unavailable", "Computer Use is not available in this build.");
}

export function isBrokerMethod(_method) {
  return false;
}

export function isReadOnlyBrokerMethod(_method) {
  return false;
}

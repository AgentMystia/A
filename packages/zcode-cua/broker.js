import { join } from "node:path";

// 发布包的交换 chunk 只有 socket 交换。方法表、恢复文案后的残留常量和 exit-log
// 留在这条静态链上，main 的 paths chunk、host index、scheduler index 才会带上它们。
// helperHealth 不能从本文件加载，否则交换 chunk 会把方法表一并带走。
// 残留常量必须排在 catalog 之后：写进 catalog 文件会被抬到方法表前面。
import "./helper-broker-catalog.js";
import "./helper-hold-duration.js";
import "./helper-published-peer-freeze.js";
import "./helper-published-async-local.js";
import "./helper-published-deadline-keys.js";
import "./helper-exit-log.js";
import {
  brokerExchange,
  callBrokerMethod,
  CuaHelperError,
  isCuaHelperError,
  probeHelperHealth,
} from "./broker-exchange.js";

export { brokerExchange, callBrokerMethod, CuaHelperError, isCuaHelperError, probeHelperHealth };

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

const brokerErrorFactory = (code) => (message, details) =>
  new BrokerError(message ?? code, { code, details });

export const notAuthorized = brokerErrorFactory("not_authorized");
export const notSelectable = brokerErrorFactory("not_selectable");
export const notSettable = brokerErrorFactory("not_settable");
export const elementUnavailable = brokerErrorFactory("element_unavailable");
export const actionUnavailable = brokerErrorFactory("action_unavailable");
export const foregroundRequired = brokerErrorFactory("foreground_required");

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

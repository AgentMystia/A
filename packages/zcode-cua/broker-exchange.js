// 发布包在 net import 后面还有一次初始化。这条回边补上少掉的字节，但 esbuild 仍把调用放在 import 前面。
import "./broker-helper-health.js";
import { createConnection } from "node:net";

// 发布包的交换 chunk 只有 socket 交换和 CuaHelperError。
// 方法表、exit-log、命名管道判断留在 broker.js 的静态链上。
// helperHealth 只加载本文件，host 用到的 isCuaHelperError 才会留在交换 chunk，
// main 和 scheduler 没有调用，产物里不会出现这个名字。

export class CuaHelperError extends Error {
  // 发布包保留未初始化的 code 字段，不能只在构造函数里赋值。
  code;
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

class BrokerAuthRejectedError extends Error {}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 发布包 host chunk 里的简单交换，和 PermissionBrokerClient 不是同一条协议。
 * 先发 id 0 的空 authenticate，再发 id 1 的业务方法。坏 JSON 行跳过。
 */
export function brokerExchange(request) {
  // 发布包是 function(a){let{...}=a}。参数解构会少 3 字节。
  let { socketPath, method, params, timeoutMs } = request;
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
          } else {
            // 发布包保留 else。提前赋值会在压缩后丢掉 else{...}，交换 chunk 少 6 字节。
            authenticated = true;
            if (message.ok !== true) {
              finish(() => reject(new BrokerAuthRejectedError("broker auth rejected")));
              return;
            }
            socket.write(`${JSON.stringify({ id: 1, method, params })}\n`);
          }
        }
        newline = buffer.indexOf("\n");
      }
    });
    socket.on("timeout", () =>
      finish(() => reject(new Error(sanitize("broker exchange timed out")))),
    );
  });
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
        // 发布包先把 bundleId / pid 放进 let，再返回。写进对象字面量会少这几个局部绑定。
        let bundleId = typeof result.bundle_id === "string" ? result.bundle_id : null;
        let pid = typeof result.pid === "number" ? result.pid : null;
        return { bundleId, pid };
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
  throw new CuaHelperError(
    "health_timeout",
    `ZCode Computer Use did not become ready within ${timeoutMs}ms. It may have failed to launch or lacks required permissions (${lastError instanceof Error ? lastError.message : String(lastError ?? "no connection")}).`,
  );
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

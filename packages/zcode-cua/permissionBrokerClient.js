import { statSync } from "node:fs";
import { createConnection } from "node:net";

import {
  BROKER_UNAVAILABLE,
  PermissionBrokerError,
  brokerUnavailableFromTransport,
  businessResponseTimeout,
  cancelledBrokerError,
  extractAuthErrorMessage,
  invalidResponseError,
  isValidErrorEnvelope,
  parseErrorPayload,
  permissionBrokerPermissionError,
  wrapPeerCheckError,
  wrapTransportError,
} from "./permissionBrokerError.js";

export {
  BROKER_UNAVAILABLE,
  PermissionBrokerError,
  boundedHoldDuration,
  businessResponseTimeout,
  legacyHelperMessageProvesActionNotSent,
  mismatchError,
} from "./permissionBrokerError.js";

const ALLOW_ANY_PEER_ENV = "ZCODE_CUA_BROKER_ALLOW_ANY_PEER";
const DEV_BROKER_ENV = "ZCODE_CUA_ALLOW_DEV_BROKER";
const DEV_BROKER_TRUTHY = new Set(["1", "true", "yes", "on"]);
const WINDOWS_HELPER_PIPE = /^\\\\\.\\pipe\\zcode-cua-helper-(?:[0-9a-f]{8,}|default)$/;
const DEFAULT_MAX_FRAME_BYTES = 67_108_864;

export function devBrokerOptIn(env = process.env) {
  const value = env[DEV_BROKER_ENV];
  if (typeof value !== "string") return false;
  return DEV_BROKER_TRUTHY.has(value.trim().toLowerCase());
}

export function allowAnyPeer(env = process.env) {
  const value = env[ALLOW_ANY_PEER_ENV];
  if (typeof value !== "string") return false;
  return value.trim().toLowerCase().length > 0;
}

/** 发布包 host `defaultPeerCredentialChecker`。stat 失败时放行，world-writable 拒绝。 */
export function defaultPeerCredentialChecker(env = process.env) {
  return {
    verifySocketPeer(socketPath) {
      if (allowAnyPeer(env) && devBrokerOptIn(env)) return;
      if (process.platform === "win32") {
        if (!WINDOWS_HELPER_PIPE.test(socketPath)) {
          throw new PermissionBrokerError(
            `refusing broker pipe outside zcode-cua-helper namespace: ${socketPath}`,
            {
              code: "untrusted_socket",
            },
          );
        }
        return;
      }
      const uid = typeof process.geteuid === "function" ? process.geteuid() : undefined;
      if (uid === undefined) return;
      let stat;
      try {
        const file = statSync(socketPath);
        stat = { uid: file.uid, mode: file.mode };
      } catch {
        return;
      }
      if (stat.uid !== uid && stat.uid !== 0) {
        throw new PermissionBrokerError(
          `refusing broker socket ${socketPath}: owned by uid ${stat.uid}, expected ${uid}`,
          {
            code: "untrusted_socket",
          },
        );
      }
      if (stat.mode & 2) {
        throw new PermissionBrokerError(`refusing broker socket ${socketPath}: world-writable`, {
          code: "untrusted_socket",
        });
      }
    },
  };
}

export class PermissionBrokerClient {
  constructor(socketPath, options) {
    if (!socketPath || !socketPath.trim()) {
      throw new Error("permission broker socket path must be non-empty");
    }
    if (
      typeof options.timeoutMs !== "number" ||
      !Number.isFinite(options.timeoutMs) ||
      options.timeoutMs <= 0
    ) {
      throw new Error(
        `permission broker timeout must be a finite, positive number of milliseconds, got ${options.timeoutMs}`,
      );
    }
    this.socketPath = socketPath;
    this.timeoutMs = options.timeoutMs;
    this.peerChecker = options.peerChecker ?? defaultPeerCredentialChecker();
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.cancelSignal = options.cancelSignal;
    this.onPresentation = options.onPresentation;
    this.authenticateParams =
      options.authenticateParams && Object.keys(options.authenticateParams).length > 0
        ? { ...options.authenticateParams }
        : null;
    this._nextId = 0;
  }

  requestId() {
    this._nextId += 1;
    return this._nextId;
  }

  async call(method, params) {
    if (this.cancelSignal?.cancelled) throw cancelledBrokerError();
    const requestId = this.requestId();
    const requestFrame = `${JSON.stringify({ id: requestId, method, params })}\n`;
    const authenticateParams = { clientApiVersion: 2, ...this.authenticateParams };
    const authenticateFrame = `${JSON.stringify({ id: 0, method: "authenticate", params: authenticateParams })}\n`;
    const timeoutMs = businessResponseTimeout(this.timeoutMs, method, params);
    let deliveryState = "not_sent";
    const sanitize = (value) => value.split(this.socketPath).join("<socket>");
    let buffer = "";
    let authenticated = false;
    const outcome = { result: null, error: null };
    const socket = createConnection(this.socketPath);

    await new Promise((resolve) => {
      let settled = false;
      let unsubscribe = () => {};
      // destroy 可能异步发出 close。结果必须写在 finish 回调里，close 看到 result/error 后不再覆盖。
      const finish = (apply) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        try {
          socket.destroy();
        } catch {
          // 连接已经销毁时保留已记录的 RPC 结果。
        }
        apply();
        resolve();
      };
      const cancelBeforeSend = () => {
        if (deliveryState === "not_sent")
          finish(() => {
            outcome.error = cancelledBrokerError();
          });
      };
      if (this.cancelSignal?.onCancel) unsubscribe = this.cancelSignal.onCancel(cancelBeforeSend);
      if (this.cancelSignal?.cancelled) cancelBeforeSend();

      socket.on("close", () => {
        if ((authenticated && outcome.result) || outcome.error) return;
        const state = deliveryState;
        finish(() => {
          outcome.error = brokerUnavailableFromTransport(
            sanitize("broker connection closed before reply"),
            state,
            "connection_closed",
          );
        });
      });
      socket.on("error", (error) => {
        if (outcome.error || outcome.result) return;
        const state = deliveryState;
        finish(() => {
          outcome.error = wrapTransportError(error, sanitize, state);
        });
      });
      socket.setTimeout(timeoutMs);
      socket.setEncoding("utf8");
      socket.on("connect", () => {
        try {
          this.peerChecker.verifySocketPeer(this.socketPath, socket);
        } catch (error) {
          const state = deliveryState;
          finish(() => {
            outcome.error = wrapPeerCheckError(error, state);
          });
          return;
        }
        socket.write(authenticateFrame);
      });
      socket.on("timeout", () => {
        if (outcome.error || outcome.result) return;
        const state = deliveryState;
        finish(() => {
          outcome.error = wrapTransportError(
            new Error(sanitize("broker exchange timed out")),
            sanitize,
            state,
            "timeout",
          );
        });
      });
      socket.on("data", (chunk) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line.trim()) continue;
          if (line.length > this.maxFrameBytes) {
            const state = deliveryState;
            finish(() => {
              outcome.error = new PermissionBrokerError(
                `ZCode permission broker frame exceeded ${this.maxFrameBytes} bytes`,
                { code: BROKER_UNAVAILABLE, details: { request_delivery_state: state } },
              );
            });
            return;
          }
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            const state = authenticated ? "possibly_sent" : deliveryState;
            finish(() => {
              outcome.error = new PermissionBrokerError(
                "ZCode permission broker returned invalid JSON",
                {
                  code: BROKER_UNAVAILABLE,
                  details: { broker_response_state: "invalid_json", request_delivery_state: state },
                },
              );
            });
            return;
          }
          if (
            this.#handleFrame(message, {
              requestId,
              requestFrame,
              socket,
              authenticated,
              deliveryState,
              outcome,
              finish,
              sanitize,
            })
          ) {
            authenticated = true;
            deliveryState = "possibly_sent";
          }
          if (settled) return;
        }
      });
    });

    if (outcome.error) throw outcome.error;
    if (outcome.result) return outcome.result.value;
    throw new PermissionBrokerError("ZCode permission broker exchange ended without a reply", {
      code: BROKER_UNAVAILABLE,
      details: { request_delivery_state: deliveryState },
    });
  }

  #handleFrame(message, frame) {
    const notObject = message === null || typeof message !== "object" || Array.isArray(message);
    if (!frame.authenticated && (message?.id === 0 || notObject)) {
      if (notObject) {
        frame.finish(() => {
          frame.outcome.error = permissionBrokerPermissionError(
            "ZCode permission broker returned a non-object authenticate response",
            { code: "not_authorized" },
          );
        });
        return false;
      }
      if (message.ok === true) {
        frame.socket.write(frame.requestFrame);
        return true;
      }
      const reason = extractAuthErrorMessage(message);
      frame.finish(() => {
        frame.outcome.error = permissionBrokerPermissionError(
          `ZCode permission broker rejected authenticate: ${reason}`,
          { code: "not_authorized" },
        );
      });
      return false;
    }
    if (notObject) {
      frame.finish(() => {
        frame.outcome.error = invalidResponseError(
          "ZCode permission broker response must be a JSON object",
          "non_object",
        );
      });
      return false;
    }
    if (message.id !== frame.requestId) {
      frame.finish(() => {
        frame.outcome.error = invalidResponseError(
          `ZCode permission broker response id mismatch: expected ${frame.requestId}, got ${JSON.stringify(message.id)}`,
          "id_mismatch",
        );
      });
      return false;
    }
    if (typeof message.ok !== "boolean") {
      frame.finish(() => {
        frame.outcome.error = invalidResponseError(
          "ZCode permission broker response has an invalid ok field",
          "invalid_envelope",
        );
      });
      return false;
    }
    if (message.ok === true) {
      frame.finish(() => {
        if (message.presentation !== undefined) {
          try {
            this.onPresentation?.(message.presentation);
          } catch {
            // presentation 回调失败不改写 RPC 结果。
          }
        }
        frame.outcome.result = { value: message.result };
      });
      return false;
    }
    if (!isValidErrorEnvelope(message.error)) {
      frame.finish(() => {
        frame.outcome.error = invalidResponseError(
          "ZCode permission broker returned an invalid error envelope",
          "invalid_envelope",
        );
      });
      return false;
    }
    const parsed = parseErrorPayload(message.error);
    frame.finish(
      parsed.code === "permission_denied" || parsed.code === "not_authorized"
        ? () => {
            frame.outcome.error = permissionBrokerPermissionError(parsed.message, {
              code: parsed.code,
              details: parsed.details,
            });
          }
        : () => {
            frame.outcome.error = new PermissionBrokerError(parsed.message, {
              code: parsed.code,
              details: parsed.details,
            });
          },
    );
    return false;
  }
}

import {
  mismatchError,
  PermissionBrokerClient,
  PermissionBrokerError,
} from "./permissionBrokerClient.js";
import { pipSessionEventSchema } from "./pip-session-schema.js";

const PIP_PROTOCOL_VERSION = 2;
const PIP_RUNTIME_ID = "zcode-cua-pip-session-v2";

/**
 * 发布包 host `createPipSessionClient`。
 * 诊断只发第一次；version_mismatch 之后 enabled 变 false，后续 send 直接抛原错误。
 */
export function createPipSessionClient(options = {}) {
  const broker = new PermissionBrokerClient(options.socketPath, {
    authenticateParams: { role: "presentation" },
    timeoutMs: options.timeoutMs ?? 3_000,
    peerChecker: options.peerChecker,
  });
  const reconnectAttempts = Math.max(0, options.reconnectAttempts ?? 2);
  const reconnectDelayMs = Math.max(0, options.reconnectDelayMs ?? 50);
  let closed = false;
  let connected = false;
  let mismatch = null;
  let queue = Promise.resolve();
  let diagnosticEmitted = false;

  function emitDiagnostic(diagnostic) {
    if (diagnosticEmitted) return;
    diagnosticEmitted = true;
    try {
      options.onDiagnostic?.(diagnostic);
    } catch {
      // 诊断回调不能打断握手或发送。
    }
  }

  function disableForMismatch(error) {
    connected = false;
    mismatch = error;
    emitDiagnostic({ code: "version_mismatch", message: error.message });
  }

  async function callWithReconnect(method, params) {
    let lastError;
    for (let attempt = 0; attempt <= reconnectAttempts; attempt += 1) {
      try {
        return await broker.call(method, params);
      } catch (error) {
        lastError = error;
        if (error instanceof PermissionBrokerError && error.code === "version_mismatch") {
          disableForMismatch(error);
          throw error;
        }
        const unavailable =
          error instanceof PermissionBrokerError && error.code === "broker_unavailable";
        if (!unavailable || attempt === reconnectAttempts) {
          if (unavailable && attempt === reconnectAttempts) {
            emitDiagnostic({ code: "transport_unavailable", message: error.message });
          }
          throw error;
        }
        if (reconnectDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs));
        }
      }
    }
    throw lastError;
  }

  async function connectTransport() {
    if (closed) throw new Error("PiP session client is closed");
    if (mismatch) throw mismatch;
    if (connected) return;
    const handshake = await callWithReconnect("pip_session_handshake", {
      protocolVersion: PIP_PROTOCOL_VERSION,
      runtimeId: PIP_RUNTIME_ID,
    });
    if (
      handshake.ready !== true ||
      handshake.protocolVersion !== PIP_PROTOCOL_VERSION ||
      handshake.runtimeId !== PIP_RUNTIME_ID
    ) {
      const error = mismatchError(
        "PiP session handshake returned a different protocol/runtime; Auto-PiP is disabled",
      );
      disableForMismatch(error);
      throw error;
    }
    connected = true;
  }

  function enqueue(task) {
    const run = queue.then(task, task);
    queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  return {
    connect: () => enqueue(connectTransport),
    send: (event) =>
      enqueue(async () => {
        if (mismatch) throw mismatch;
        // 发布包 host 直接 `$h.parse`，没有 parsePipSessionEvent keepName。
        const parsed = pipSessionEventSchema.parse(event);
        await connectTransport();
        return callWithReconnect("pip_session_event", { event: parsed });
      }),
    get enabled() {
      return !closed && mismatch === null;
    },
    close() {
      closed = true;
      connected = false;
    },
  };
}

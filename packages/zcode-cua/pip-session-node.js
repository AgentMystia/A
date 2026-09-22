import {
  mismatchError,
  PermissionBrokerClient,
  PermissionBrokerError,
} from "./permissionBrokerClient.js";

const PIP_PROTOCOL_VERSION = 2;
const PIP_RUNTIME_ID = "zcode-cua-pip-session-v2";
const RESERVED_PIP_IDENTIFIER = "__zcode_pip_no_active_session_v2__";

function parseIdentifier(value) {
  if (typeof value !== "string") throw new Error("identifier must be a string");
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 255)
    throw new Error("identifier length is outside 1..255");
  if (trimmed.includes("\0")) throw new Error("identifier cannot contain NUL");
  if (trimmed === RESERVED_PIP_IDENTIFIER) {
    throw new Error("identifier is reserved by the PiP session runtime");
  }
  return trimmed;
}

function parseNonNegativeInt(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("expected a nonnegative safe integer");
  }
  return value;
}

function assertExactKeys(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PiP event must be an object");
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error("PiP event fields do not match the published schema");
  }
}

/** 发布包 host `$h`。strict object，多出来的 kind 或字段直接拒绝。 */
export function parsePipSessionEvent(value) {
  if (value.kind === "focus-changed") {
    assertExactKeys(value, ["kind", "revision", "sourceWindowId", "sessionId"]);
    return {
      kind: "focus-changed",
      revision: parseNonNegativeInt(value.revision),
      sourceWindowId: parseIdentifier(value.sourceWindowId),
      sessionId: value.sessionId === null ? null : parseIdentifier(value.sessionId),
    };
  }
  if (value.kind === "turn-started") {
    assertExactKeys(value, ["kind", "sessionId", "turnId", "sequenceNumber", "eventId"]);
    return {
      kind: "turn-started",
      sessionId: parseIdentifier(value.sessionId),
      turnId: parseIdentifier(value.turnId),
      sequenceNumber: parseNonNegativeInt(value.sequenceNumber),
      eventId: parseIdentifier(value.eventId),
    };
  }
  if (value.kind === "turn-ended") {
    assertExactKeys(value, ["kind", "sessionId", "turnId", "sequenceNumber", "eventId", "outcome"]);
    if (value.outcome !== "completed" && value.outcome !== "failed") {
      throw new Error("turn-ended outcome must be completed or failed");
    }
    return {
      kind: "turn-ended",
      sessionId: parseIdentifier(value.sessionId),
      turnId: parseIdentifier(value.turnId),
      sequenceNumber: parseNonNegativeInt(value.sequenceNumber),
      eventId: parseIdentifier(value.eventId),
      outcome: value.outcome,
    };
  }
  if (value.kind === "session-closed") {
    assertExactKeys(value, ["kind", "sessionId", "sequenceNumber", "eventId"]);
    return {
      kind: "session-closed",
      sessionId: parseIdentifier(value.sessionId),
      sequenceNumber: parseNonNegativeInt(value.sequenceNumber),
      eventId: parseIdentifier(value.eventId),
    };
  }
  throw new Error("PiP event kind is not in the published schema");
}

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
        const parsed = parsePipSessionEvent(event);
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

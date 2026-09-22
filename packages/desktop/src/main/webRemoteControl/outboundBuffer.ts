import type { WebRemoteControlLogger, WebRemoteControlRuntime } from "./runtimeTypes.js";
import {
  WEB_REMOTE_CONTROL_OUTBOUND_BUFFER_LIMIT,
  WEB_REMOTE_CONTROL_OUTBOUND_DROP_MS,
} from "./runtimeTypes.js";

export function clearPendingOutboundTimer(runtime: WebRemoteControlRuntime): void {
  if (!runtime.pendingOutboundPayloadTimer) return;
  clearTimeout(runtime.pendingOutboundPayloadTimer);
  runtime.pendingOutboundPayloadTimer = undefined;
}

export function clearMobileDisconnectGrace(runtime: WebRemoteControlRuntime): void {
  if (!runtime.mobileDisconnectGraceTimer) return;
  clearTimeout(runtime.mobileDisconnectGraceTimer);
  runtime.mobileDisconnectGraceTimer = undefined;
}

function sendToTransport(
  runtime: WebRemoteControlRuntime,
  payload: object,
): {
  kind: "sent" | "unavailable" | "oversize";
  bytes?: number;
  maxBytes?: number;
} {
  return runtime.transport.sendPayloadResult
    ? runtime.transport.sendPayloadResult(payload)
    : runtime.transport.sendPayload(payload)
      ? { kind: "sent", bytes: 0 }
      : { kind: "unavailable" };
}

function scheduleDrop(runtime: WebRemoteControlRuntime, logger: WebRemoteControlLogger): void {
  if (runtime.pendingOutboundPayloadTimer || runtime.pendingOutboundPayloads.length === 0) return;
  runtime.pendingOutboundPayloadTimer = setTimeout(() => {
    runtime.pendingOutboundPayloadTimer = undefined;
    const droppedCount = runtime.pendingOutboundPayloads.splice(0).length;
    logger.warn("[web-remote-control] dropped buffered outbound payloads", {
      windowId: runtime.windowId,
      session: runtime.deviceSid,
      droppedCount,
    });
  }, WEB_REMOTE_CONTROL_OUTBOUND_DROP_MS);
}

function bufferPayload(
  runtime: WebRemoteControlRuntime,
  payload: object,
  logger: WebRemoteControlLogger,
): void {
  if (runtime.pendingOutboundPayloads.length >= WEB_REMOTE_CONTROL_OUTBOUND_BUFFER_LIMIT) {
    const droppedCount = runtime.pendingOutboundPayloads.length + 1;
    runtime.pendingOutboundPayloads.length = 0;
    clearPendingOutboundTimer(runtime);
    logger.warn("[web-remote-control] dropped overflowing outbound payloads", {
      windowId: runtime.windowId,
      session: runtime.deviceSid,
      droppedCount,
    });
    return;
  }
  runtime.pendingOutboundPayloads.push(payload);
  scheduleDrop(runtime, logger);
}

export function flushPendingOutboundPayloads(
  runtime: WebRemoteControlRuntime,
  logger: WebRemoteControlLogger,
): void {
  while (runtime.pendingOutboundPayloads.length > 0) {
    const payload = runtime.pendingOutboundPayloads[0];
    if (!payload) break;
    const result = sendToTransport(runtime, payload);
    if (result.kind === "unavailable") {
      scheduleDrop(runtime, logger);
      return;
    }
    if (result.kind === "oversize") {
      logger.warn("[web-remote-control] dropped oversize app payload", {
        zcodeType: "zcode_type" in payload ? payload.zcode_type : undefined,
        bytes: result.bytes,
        maxBytes: result.maxBytes,
      });
    }
    runtime.pendingOutboundPayloads.shift();
  }
  clearPendingOutboundTimer(runtime);
}

export function sendAppPayload(
  runtime: WebRemoteControlRuntime,
  payload: object,
  logger: WebRemoteControlLogger,
): void {
  if (runtime.pendingOutboundPayloads.length > 0) {
    bufferPayload(runtime, payload, logger);
    flushPendingOutboundPayloads(runtime, logger);
    return;
  }
  const result = sendToTransport(runtime, payload);
  if (result.kind === "sent") return;
  if (result.kind === "oversize") {
    logger.warn("[web-remote-control] rejected oversize app payload", {
      zcodeType: "zcode_type" in payload ? payload.zcode_type : undefined,
      bytes: result.bytes,
      maxBytes: result.maxBytes,
    });
    return;
  }
  bufferPayload(runtime, payload, logger);
}

import { createHash } from "node:crypto";
import { WebSocket, type RawData } from "ws";
import { WEB_REMOTE_CONTROL_RPC_LIMITS, type WebRemoteControlAppPayload } from "@zcode/shared";
import { WebRemoteControlRelayPayloadSerializer } from "@zcode/shared/webRemoteControlRelayPayloadSerializer";
import type { WebRemoteControlRelayAuthProvider } from "./auth.js";
import {
  clearReconnectTimer,
  clearStaleWaitingRecoveryTimer,
  handleRelayMessage,
  scheduleReconnect,
  sendAuthInit,
  stopHeartbeat,
  type WebRemoteControlDeviceTransportSession,
} from "./deviceTransportSession.js";
import { noteWebRemoteRelayConnectAttempt, noteWebRemoteRelayReconnect } from "./relayTelemetry.js";

export type WebRemoteControlTransportState =
  | "idle"
  | "connecting"
  | "registering"
  | "authenticating"
  | "waiting_terminal"
  | "paired"
  | "error"
  | "kicked";

export type WebRemoteControlTransportAuth =
  | { mode: "register"; passHash: string }
  | { mode: "persisted"; deviceSid: string; passHash: string };

export interface WebRemoteControlSendResult {
  kind: "sent" | "unavailable" | "oversize";
  bytes?: number;
  maxBytes?: number;
}

export interface WebRemoteControlDeviceTransportOptions {
  relayWsUrl: string;
  deviceMid: string;
  auth: WebRemoteControlTransportAuth;
  meta: { platform: string; version: string; name: string };
  authProvider: WebRemoteControlRelayAuthProvider;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  relayMessageLogger?: { info: (entry: unknown) => void };
  heartbeatIntervalMs?: number;
  heartbeatJitterMs?: number;
  heartbeatAckTimeoutMs?: number;
  reconnectDelayMs?: number;
  reconnectJitterMs?: number;
  onRegisteredAuth: (auth: { deviceSid: string; passHash: string }) => void;
  onStateChange: (state: WebRemoteControlTransportState) => void;
  onPayload: (payload: WebRemoteControlAppPayload) => void;
  onRawTransportPayload?: (payload: unknown) => boolean;
  onRawTransportFault?: (reasonCode: string) => void;
  onSendReady?: (detail: { kind: "same-socket" | "reconnected-socket" }) => void;
  onError: (error: Error) => void;
  onInvalidPersistedAuth: () => Promise<void>;
}

function estimateRawDataBytes(data: unknown): number {
  if (Array.isArray(data)) return data.reduce((sum, part) => sum + estimateRawDataBytes(part), 0);
  if (typeof data === "string") return Buffer.byteLength(data, "utf8");
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return data.byteLength;
  return Buffer.byteLength(String(data), "utf8");
}

function toBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (typeof data === "string") return Buffer.from(data);
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  const view = data as ArrayBufferView;
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

function parseRelayMessage(data: RawData): Record<string, unknown> | null {
  // 发布包在解析前用同一字节上限丢掉超限帧。只留在 message 回调里会少这段判断。
  if (estimateRawDataBytes(data) > WEB_REMOTE_CONTROL_RPC_LIMITS.maxPhysicalFrameBytes) return null;
  try {
    const parsed: unknown = JSON.parse(toBuffer(data).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function safePayloadMetadata(payload: unknown): {
  zcode_type?: string;
  requestId?: string;
  bridgeSessionId?: string;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const record = payload as Record<string, unknown>;
  return {
    zcode_type: typeof record.zcode_type === "string" ? record.zcode_type : undefined,
    requestId: typeof record.requestId === "string" ? record.requestId : undefined,
    bridgeSessionId:
      typeof record.bridgeSessionId === "string" ? record.bridgeSessionId : undefined,
  };
}

function summarizeRelayMessageForTrace(message: {
  type?: unknown;
  payload?: unknown;
  pair_status?: unknown;
  role?: unknown;
  code?: unknown;
}): Record<string, unknown> {
  if (message.type === "pair_status_ack")
    return { type: message.type, pair_status: message.pair_status };
  if (message.type === "auth_init") return { type: message.type, role: message.role };
  if (message.type === "data") {
    const payload = message.payload;
    const seq =
      payload && typeof payload === "object" && !Array.isArray(payload) && "seq" in payload
        ? (payload as { seq?: unknown }).seq
        : undefined;
    return {
      type: message.type,
      payload: safePayloadMetadata(message.payload),
      ...(typeof seq === "number" ? { seq } : {}),
    };
  }
  return message.type === "error"
    ? { type: message.type, code: message.code }
    : { type: message.type };
}

function createMessageHashFromRaw(data: RawData): string {
  const bytes =
    typeof data === "string"
      ? Buffer.from(data, "utf8")
      : data instanceof ArrayBuffer
        ? Buffer.from(data)
        : ArrayBuffer.isView(data)
          ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
          : Buffer.from(String(data), "utf8");
  return createHash("sha1").update(bytes).digest("hex").slice(0, 16);
}

function createMessageHashFromText(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex").slice(0, 16);
}

export class WebRemoteControlDeviceTransport implements WebRemoteControlDeviceTransportSession {
  socket: WebSocket | undefined;
  state: WebRemoteControlTransportState = "idle";
  activeAuth: WebRemoteControlTransportAuth;
  deviceSid: string | undefined;
  manuallyClosed = false;
  terminalClose = false;
  invalidPersistedRetryUsed = false;
  suppressNextCloseReconnect = false;
  wasPaired = false;
  staleWaitingCount = 0;
  lastPairStatusAckAt = 0;
  heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  heartbeatAckWatchdogTimer: ReturnType<typeof setTimeout> | undefined;
  reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  staleWaitingRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly traceRelayMessages = false;
  connectStartedAt = 0;
  connectAttempt = 0;
  socketGeneration = 0;
  lastPairedSocketGeneration = 0;
  private readonly payloadSerializer = new WebRemoteControlRelayPayloadSerializer();
  readonly options: WebRemoteControlDeviceTransportOptions;

  constructor(options: WebRemoteControlDeviceTransportOptions) {
    this.options = options;
    this.activeAuth = options.auth;
    this.deviceSid = options.auth.mode === "persisted" ? options.auth.deviceSid : undefined;
  }

  start(): void {
    this.manuallyClosed = false;
    this.terminalClose = false;
    this.wasPaired = false;
    this.lastPairedSocketGeneration = 0;
    this.staleWaitingCount = 0;
    this.lastPairStatusAckAt = 0;
    this.connect();
  }

  sendPayload(payload: object): boolean {
    return this.sendPayloadResult(payload).kind === "sent";
  }

  measurePayloadBytes(payload: object): number {
    return this.payloadSerializer.prepare(payload).bytes;
  }

  sendPayloadResult(payload: object): WebRemoteControlSendResult {
    const prepared = this.payloadSerializer.prepare(payload);
    if (this.payloadSerializer.isOversize(prepared)) {
      return {
        kind: "oversize",
        bytes: prepared.bytes,
        maxBytes: WEB_REMOTE_CONTROL_RPC_LIMITS.maxPhysicalFrameBytes,
      };
    }
    if (this.state !== "paired" || this.staleWaitingCount > 0) return { kind: "unavailable" };
    return this.sendSerialized(prepared.message, prepared.json)
      ? { kind: "sent", bytes: prepared.bytes }
      : { kind: "unavailable" };
  }

  dispose(): void {
    this.manuallyClosed = true;
    clearReconnectTimer(this);
    stopHeartbeat(this);
    clearStaleWaitingRecoveryTimer(this);
    this.socket?.close();
    this.socket = undefined;
    this.setState("idle");
  }

  connect(): void {
    clearReconnectTimer(this);
    stopHeartbeat(this);
    clearStaleWaitingRecoveryTimer(this);
    this.connectAttempt += 1;
    this.socketGeneration += 1;
    this.connectStartedAt = Date.now();
    this.setState("connecting");
    this.lastPairStatusAckAt = Date.now();
    this.options.logger.info("[web-remote-control] external relay device connecting");
    const url = new URL(this.options.relayWsUrl);
    url.searchParams.set("mid", this.options.deviceMid);
    const socket = new WebSocket(url.toString(), {
      perMessageDeflate: true,
      headers: { "X-Device-ID": this.options.deviceMid },
    });
    this.socket = socket;
    socket.on("open", () => {
      if (socket !== this.socket) return;
      const extensions = typeof socket.extensions === "string" ? socket.extensions : "";
      this.options.logger.info("[web-remote-control] external relay negotiated extensions", {
        perMessageDeflate: extensions.includes("permessage-deflate"),
        extensions: extensions || undefined,
      });
      if (this.activeAuth.mode === "register") {
        this.setState("registering");
        this.send({
          type: "device_register_init",
          device_mid: this.options.deviceMid,
          pass_hash: this.activeAuth.passHash,
          meta: this.options.meta,
          client_ts: Date.now(),
        });
        return;
      }
      sendAuthInit(this, this.activeAuth.deviceSid);
    });
    socket.on("message", (data) => {
      if (socket !== this.socket) return;
      const bytes = estimateRawDataBytes(data);
      if (bytes > WEB_REMOTE_CONTROL_RPC_LIMITS.maxPhysicalFrameBytes) {
        this.options.logger.warn("[web-remote-control] oversize external relay message dropped", {
          bytes,
          maxBytes: WEB_REMOTE_CONTROL_RPC_LIMITS.maxPhysicalFrameBytes,
        });
        this.options.onRawTransportFault?.("remote.rpcFrame.envelopeTooLarge");
        return;
      }
      const message = parseRelayMessage(data);
      if (!message) {
        this.options.logger.warn("[web-remote-control] invalid external relay message");
        return;
      }
      this.logRelayTrace("recv", {
        ...summarizeRelayMessageForTrace(message),
        bytes,
        contentHash: createMessageHashFromRaw(data),
      });
      void handleRelayMessage(this, message);
    });
    socket.on("error", (error) => {
      if (socket !== this.socket) return;
      this.options.logger.warn("[web-remote-control] external relay device socket error", {
        message: error.message,
      });
      noteWebRemoteRelayConnectAttempt(Date.now() - this.connectStartedAt, false, {
        error,
        attempt: this.connectAttempt,
      });
      this.options.onError(error);
    });
    socket.on("close", () => {
      if (socket !== this.socket) return;
      stopHeartbeat(this);
      if (this.suppressNextCloseReconnect) {
        this.suppressNextCloseReconnect = false;
        return;
      }
      if (this.manuallyClosed || this.terminalClose) return;
      this.options.logger.warn("[web-remote-control] external relay device disconnected");
      if (this.state !== "paired") {
        noteWebRemoteRelayConnectAttempt(Date.now() - this.connectStartedAt, false, {
          attempt: this.connectAttempt,
        });
      }
      noteWebRemoteRelayReconnect();
      scheduleReconnect(this);
    });
  }

  setState(state: WebRemoteControlTransportState): void {
    if (this.state === state) return;
    const previous = this.state;
    this.state = state;
    if (state === "paired" && previous !== "paired" && this.connectStartedAt > 0) {
      noteWebRemoteRelayConnectAttempt(Date.now() - this.connectStartedAt, true, {
        attempt: this.connectAttempt,
      });
    }
    this.options.onStateChange(state);
    if (
      state === "connecting" ||
      state === "registering" ||
      state === "authenticating" ||
      state === "waiting_terminal" ||
      state === "paired" ||
      state === "kicked"
    ) {
      this.options.logger.info("[web-remote-control] external relay device state", { state });
    }
  }

  send(message: { type: string; [key: string]: unknown }): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    const json = JSON.stringify(message);
    const bytes = Buffer.byteLength(json, "utf8");
    if (bytes > WEB_REMOTE_CONTROL_RPC_LIMITS.maxPhysicalFrameBytes) {
      this.options.logger.warn("[web-remote-control] outbound relay message exceeds hard limit", {
        type: message.type,
        bytes,
        maxBytes: WEB_REMOTE_CONTROL_RPC_LIMITS.maxPhysicalFrameBytes,
      });
      return false;
    }
    return this.sendSerialized(message, json);
  }

  private sendSerialized(
    message: { type?: string; [key: string]: unknown },
    json: string,
  ): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.logRelayTrace("send", {
      ...summarizeRelayMessageForTrace(message),
      bytes: Buffer.byteLength(json, "utf8"),
      contentHash: createMessageHashFromText(json),
    });
    this.socket.send(json);
    return true;
  }

  logRelayTrace(direction: "send" | "recv", detail: Record<string, unknown>): void {
    if (!this.traceRelayMessages) return;
    const entry = { direction, ...detail };
    this.options.logger.info("[web-remote-control][relay-message]", entry);
    this.options.relayMessageLogger?.info(entry);
  }
}

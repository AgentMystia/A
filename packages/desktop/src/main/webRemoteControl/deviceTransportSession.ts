import { parseWebRemoteControlAppPayload } from "@zcode/shared";
import type { WebSocket } from "ws";
import {
  getWebRemoteControlHeartbeatDelayMs,
  getWebRemoteControlHeartbeatJitterMs,
  getWebRemoteControlReconnectJitterMs,
} from "./timing.js";
import type {
  WebRemoteControlDeviceTransportOptions,
  WebRemoteControlTransportAuth,
  WebRemoteControlTransportState,
} from "./deviceTransport.js";

const STALE_WAITING_RECOVERY_MS = 15_000;

export interface WebRemoteControlDeviceTransportSession {
  socket: WebSocket | undefined;
  state: WebRemoteControlTransportState;
  activeAuth: WebRemoteControlTransportAuth;
  deviceSid: string | undefined;
  manuallyClosed: boolean;
  terminalClose: boolean;
  invalidPersistedRetryUsed: boolean;
  suppressNextCloseReconnect: boolean;
  wasPaired: boolean;
  staleWaitingCount: number;
  lastPairStatusAckAt: number;
  socketGeneration: number;
  lastPairedSocketGeneration: number;
  heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  heartbeatAckWatchdogTimer: ReturnType<typeof setTimeout> | undefined;
  reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  staleWaitingRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
  readonly options: WebRemoteControlDeviceTransportOptions;
  setState(state: WebRemoteControlTransportState): void;
  send(message: { type: string; [key: string]: unknown }): boolean;
  connect(): void;
  logRelayTrace(direction: "send" | "recv", detail: Record<string, unknown>): void;
}

function isRawTransportCandidate(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const type = (value as { zcode_type?: unknown }).zcode_type;
  return type === "rpc-frame" || type === "rpc-frame-ack";
}

export async function handleRelayMessage(
  transport: WebRemoteControlDeviceTransportSession,
  message: Record<string, unknown>,
): Promise<void> {
  switch (message.type) {
    case "device_register_ack": {
      const deviceSid = String(message.device_sid ?? "");
      transport.deviceSid = deviceSid;
      if (transport.activeAuth.mode === "register") {
        const auth = { deviceSid, passHash: transport.activeAuth.passHash };
        transport.options.onRegisteredAuth(auth);
        transport.activeAuth = { mode: "persisted", ...auth };
      }
      sendAuthInit(transport, deviceSid);
      break;
    }
    case "auth_challenge": {
      if (!transport.deviceSid) {
        enterError(transport, new Error("External relay auth challenge arrived before device_sid"));
        return;
      }
      transport.send({
        type: "auth_response",
        device_sid: transport.deviceSid,
        proof: transport.options.authProvider.calculateProof(
          transport.activeAuth.passHash,
          String(message.nonce ?? ""),
          "device",
          transport.deviceSid,
        ),
        client_ts: Date.now(),
      });
      break;
    }
    case "auth_ack":
    case "pair_status_ack":
      applyPairStatus(transport, message.pair_status === "matched" ? "matched" : "waiting");
      break;
    case "data":
      handleDataPayload(transport, message.payload);
      break;
    case "error":
      await handleRelayError(
        transport,
        String(message.code ?? ""),
        typeof message.message === "string" ? message.message : undefined,
      );
      break;
    default:
      break;
  }
}

export function sendAuthInit(
  transport: WebRemoteControlDeviceTransportSession,
  deviceSid: string,
): void {
  transport.deviceSid = deviceSid;
  transport.setState("authenticating");
  transport.send({
    type: "auth_init",
    role: "device",
    device_sid: deviceSid,
    meta: transport.options.meta,
    client_ts: Date.now(),
  });
}

function applyPairStatus(
  transport: WebRemoteControlDeviceTransportSession,
  status: "waiting" | "matched",
): void {
  transport.lastPairStatusAckAt = Date.now();
  armHeartbeatAckWatchdog(transport);
  if (status === "waiting") {
    if (transport.wasPaired) {
      transport.staleWaitingCount += 1;
      startHeartbeat(transport);
      if (transport.staleWaitingCount === 1) {
        scheduleStaleWaitingRecovery(transport);
        return;
      }
      reconnectAfterStaleWaiting(transport);
      return;
    }
    transport.setState("waiting_terminal");
    startHeartbeat(transport);
    return;
  }
  const previous = transport.lastPairedSocketGeneration;
  const kind =
    previous === 0
      ? null
      : previous === transport.socketGeneration
        ? "same-socket"
        : "reconnected-socket";
  transport.staleWaitingCount = 0;
  clearStaleWaitingRecoveryTimer(transport);
  transport.setState("paired");
  transport.wasPaired = true;
  transport.lastPairedSocketGeneration = transport.socketGeneration;
  startHeartbeat(transport);
  if (kind) transport.options.onSendReady?.({ kind });
}

async function handleRelayError(
  transport: WebRemoteControlDeviceTransportSession,
  code: string,
  message: string | undefined,
): Promise<void> {
  if (code === "KICKED") {
    transport.options.logger.warn(
      "[web-remote-control] external relay device KICKED, reconnecting",
      { message },
    );
    transport.socket?.close();
    return;
  }
  if (
    code === "AUTH_FAILED" &&
    transport.activeAuth.mode === "persisted" &&
    !transport.invalidPersistedRetryUsed
  ) {
    transport.invalidPersistedRetryUsed = true;
    await transport.options.onInvalidPersistedAuth();
    transport.activeAuth = { mode: "register", passHash: transport.activeAuth.passHash };
    transport.deviceSid = undefined;
    transport.suppressNextCloseReconnect = true;
    transport.socket?.close();
    scheduleReconnect(transport, 0);
    return;
  }
  const error = new Error(message || code);
  if (code === "INTERNAL") {
    if (transport.state === "paired" || transport.state === "waiting_terminal") {
      enterWaitingForPairAfterRelayError(transport, error);
      return;
    }
    enterRecoverableError(transport, error);
    return;
  }
  if (
    code === "WRONG_PARAM" &&
    (transport.state === "paired" || transport.state === "waiting_terminal")
  ) {
    transport.options.onError(error);
    return;
  }
  enterError(transport, error);
}

function handleDataPayload(
  transport: WebRemoteControlDeviceTransportSession,
  payload: unknown,
): void {
  if (
    transport.state !== "paired" ||
    (isRawTransportCandidate(payload) && transport.options.onRawTransportPayload?.(payload))
  ) {
    return;
  }
  const parsed = parseWebRemoteControlAppPayload(payload);
  if (!parsed) {
    transport.options.logger.warn("[web-remote-control] invalid external relay payload dropped");
    return;
  }
  transport.options.onPayload(parsed);
}

function startHeartbeat(transport: WebRemoteControlDeviceTransportSession): void {
  if (transport.heartbeatTimer) return;
  armHeartbeatAckWatchdog(transport);
  scheduleHeartbeat(transport);
}

function scheduleHeartbeat(transport: WebRemoteControlDeviceTransportSession): void {
  transport.heartbeatTimer = setTimeout(
    () => {
      transport.heartbeatTimer = undefined;
      if (
        !transport.deviceSid ||
        (transport.state !== "paired" && transport.state !== "waiting_terminal")
      )
        return;
      transport.send({
        type: "pair_status_query",
        device_sid: transport.deviceSid,
        client_ts: Date.now(),
      });
      scheduleHeartbeat(transport);
    },
    getWebRemoteControlHeartbeatDelayMs(
      transport.options.heartbeatIntervalMs ?? 10_000,
      transport.options.heartbeatJitterMs,
    ),
  );
}

function armHeartbeatAckWatchdog(transport: WebRemoteControlDeviceTransportSession): void {
  if (transport.state !== "paired" && transport.state !== "waiting_terminal") return;
  if (transport.heartbeatAckWatchdogTimer) clearTimeout(transport.heartbeatAckWatchdogTimer);
  transport.heartbeatAckWatchdogTimer = setTimeout(() => {
    transport.heartbeatAckWatchdogTimer = undefined;
    if (transport.state !== "paired" && transport.state !== "waiting_terminal") return;
    transport.options.logger.warn(
      "[web-remote-control] external relay heartbeat ack timeout, reconnecting",
      {
        state: transport.state,
        staleMs: Date.now() - transport.lastPairStatusAckAt,
      },
    );
    reconnectAfterStaleWaiting(transport, getReconnectJitterMs(transport));
  }, transport.options.heartbeatAckTimeoutMs ?? 30_000);
}

function getReconnectJitterMs(transport: WebRemoteControlDeviceTransportSession): number {
  const interval = transport.options.heartbeatIntervalMs ?? 10_000;
  const heartbeatJitter = getWebRemoteControlHeartbeatJitterMs(
    interval,
    transport.options.heartbeatJitterMs,
  );
  return getWebRemoteControlReconnectJitterMs(
    transport.options.reconnectJitterMs ?? Math.min(heartbeatJitter, 2_000),
  );
}

export function stopHeartbeat(transport: WebRemoteControlDeviceTransportSession): void {
  if (transport.heartbeatTimer) clearTimeout(transport.heartbeatTimer);
  transport.heartbeatTimer = undefined;
  if (transport.heartbeatAckWatchdogTimer) clearTimeout(transport.heartbeatAckWatchdogTimer);
  transport.heartbeatAckWatchdogTimer = undefined;
}

export function scheduleReconnect(
  transport: WebRemoteControlDeviceTransportSession,
  delay = transport.options.reconnectDelayMs ?? 1_000,
): void {
  if (transport.manuallyClosed || transport.terminalClose) return;
  clearReconnectTimer(transport);
  transport.reconnectTimer = setTimeout(() => transport.connect(), delay);
}

export function clearReconnectTimer(transport: WebRemoteControlDeviceTransportSession): void {
  if (transport.reconnectTimer) clearTimeout(transport.reconnectTimer);
  transport.reconnectTimer = undefined;
}

function scheduleStaleWaitingRecovery(transport: WebRemoteControlDeviceTransportSession): void {
  if (transport.staleWaitingRecoveryTimer) return;
  transport.staleWaitingRecoveryTimer = setTimeout(() => {
    transport.staleWaitingRecoveryTimer = undefined;
    if (transport.state === "paired" && transport.staleWaitingCount > 0)
      reconnectAfterStaleWaiting(transport);
  }, STALE_WAITING_RECOVERY_MS);
}

export function clearStaleWaitingRecoveryTimer(
  transport: WebRemoteControlDeviceTransportSession,
): void {
  if (transport.staleWaitingRecoveryTimer) clearTimeout(transport.staleWaitingRecoveryTimer);
  transport.staleWaitingRecoveryTimer = undefined;
}

function reconnectAfterStaleWaiting(
  transport: WebRemoteControlDeviceTransportSession,
  delay = 0,
): void {
  clearStaleWaitingRecoveryTimer(transport);
  stopHeartbeat(transport);
  clearReconnectTimer(transport);
  transport.staleWaitingCount = 0;
  transport.wasPaired = false;
  const socket = transport.socket;
  transport.socket = undefined;
  if (delay > 0) transport.setState("connecting");
  socket?.close();
  if (delay > 0) {
    transport.reconnectTimer = setTimeout(() => {
      transport.reconnectTimer = undefined;
      if (transport.manuallyClosed || transport.terminalClose) return;
      transport.connect();
    }, delay);
    return;
  }
  transport.connect();
}

function enterError(transport: WebRemoteControlDeviceTransportSession, error: Error): void {
  transport.terminalClose = true;
  stopHeartbeat(transport);
  clearStaleWaitingRecoveryTimer(transport);
  transport.setState("error");
  transport.options.onError(error);
  transport.socket?.close();
}

function enterRecoverableError(
  transport: WebRemoteControlDeviceTransportSession,
  error: Error,
): void {
  stopHeartbeat(transport);
  clearStaleWaitingRecoveryTimer(transport);
  transport.setState("error");
  transport.options.onError(error);
  transport.socket?.close();
}

function enterWaitingForPairAfterRelayError(
  transport: WebRemoteControlDeviceTransportSession,
  error: Error,
): void {
  transport.options.onError(error);
  clearStaleWaitingRecoveryTimer(transport);
  transport.staleWaitingCount = 0;
  transport.wasPaired = false;
  startHeartbeat(transport);
  transport.setState("waiting_terminal");
}

import { WEB_REMOTE_CONTROL_RPC_LIMITS } from "./webRemoteControlRpcLimits.js";

export interface PreparedWebRemoteControlRelayPayload {
  message: { type: "data"; payload: unknown; client_ts: number };
  json: string;
  bytes: number;
}

export class WebRemoteControlRelayPayloadSerializer {
  private readonly cache = new WeakMap<object, PreparedWebRemoteControlRelayPayload>();

  prepare(payload: object, now = Date.now()): PreparedWebRemoteControlRelayPayload {
    const cached = this.cache.get(payload);
    if (cached) return cached;
    const message = { type: "data" as const, payload, client_ts: now };
    const json = JSON.stringify(message);
    const prepared = Object.freeze({
      message,
      json,
      bytes: new TextEncoder().encode(json).byteLength,
    });
    this.cache.set(payload, prepared);
    return prepared;
  }

  isOversize(prepared: PreparedWebRemoteControlRelayPayload): boolean {
    return prepared.bytes > WEB_REMOTE_CONTROL_RPC_LIMITS.maxPhysicalFrameBytes;
  }
}

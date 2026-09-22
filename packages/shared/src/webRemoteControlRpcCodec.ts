import { crc32WireBytes, encodeWireBytesBase64 } from "./zcode-protocol-v4/wire-binary.js";
import { utf8JsonByteLength } from "./zcode-protocol-v4/wire-codec.js";
import {
  assertPositiveSafeRpcInteger,
  boundedPositiveRpcLimit,
  WEB_REMOTE_CONTROL_RPC_LIMITS,
  WebRemoteControlRpcTransportEncodingError,
} from "./webRemoteControlRpcLimits.js";
import {
  parseWebRemoteControlRpcIdentity,
  webRemoteControlRpcFrameSchema,
  type WebRemoteControlRpcFrame,
  type WebRemoteControlRpcIdentity,
} from "./webRemoteControlRpcSchema.js";

export interface WebRemoteControlRpcEncodeInput {
  bridgeSessionId: string;
  bridgeGeneration?: number;
  recoveryId?: string;
  firstPhysicalSeq: number;
  messageSeq: number;
  maxPhysicalFrameBytes?: number;
  maxMessageBytes?: number;
  maxFragments?: number;
}

function frameShell(input: {
  identity: WebRemoteControlRpcIdentity;
  seq: number;
  messageSeq: number;
  fragmentIndex: number;
  fragmentCount: number;
  messageBytes: number;
  checksum: WebRemoteControlRpcFrame["checksum"];
  dataBase64: string;
}): WebRemoteControlRpcFrame {
  return {
    zcode_type: "rpc-frame",
    ...input.identity,
    seq: input.seq,
    messageSeq: input.messageSeq,
    fragmentIndex: input.fragmentIndex,
    fragmentCount: input.fragmentCount,
    messageBytes: input.messageBytes,
    checksum: input.checksum,
    dataBase64: input.dataBase64,
  };
}

export function relayEnvelopeForWebRemoteControlPayload(
  payload: unknown,
  timestamps: { clientTimestamp?: number | null; serverTimestamp?: number | null } = {},
): {
  type: "data";
  payload: unknown;
  client_ts?: number;
  server_ts?: number;
} {
  const clientTimestamp =
    timestamps.clientTimestamp === undefined ? Number.MAX_SAFE_INTEGER : timestamps.clientTimestamp;
  const serverTimestamp =
    timestamps.serverTimestamp === undefined ? Number.MAX_SAFE_INTEGER : timestamps.serverTimestamp;
  return {
    type: "data",
    payload,
    ...(clientTimestamp === null ? {} : { client_ts: clientTimestamp }),
    ...(serverTimestamp === null ? {} : { server_ts: serverTimestamp }),
  };
}

export function measureWebRemoteControlRpcRelayEnvelopeBytes(
  payload: unknown,
  timestamps?: { clientTimestamp?: number | null; serverTimestamp?: number | null },
): number {
  return utf8JsonByteLength(relayEnvelopeForWebRemoteControlPayload(payload, timestamps));
}

function base64Length(byteLength: number): number {
  return 4 * Math.ceil(byteLength / 3);
}

function findDecodedBudget(input: {
  identity: WebRemoteControlRpcIdentity;
  endSeq: number;
  messageSeq: number;
  fragmentCount: number;
  messageBytes: number;
  checksum: WebRemoteControlRpcFrame["checksum"];
  maxPhysicalFrameBytes: number;
}): number {
  const empty = frameShell({
    identity: input.identity,
    seq: input.endSeq,
    messageSeq: input.messageSeq,
    fragmentIndex: input.fragmentCount - 1,
    fragmentCount: input.fragmentCount,
    messageBytes: input.messageBytes,
    checksum: input.checksum,
    dataBase64: "",
  });
  const shellBytes = measureWebRemoteControlRpcRelayEnvelopeBytes(empty);
  let low = 0;
  let high = input.messageBytes;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (shellBytes + base64Length(mid) <= input.maxPhysicalFrameBytes) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function encodeWebRemoteControlRpcTransportMessage(
  bytes: Uint8Array,
  input: WebRemoteControlRpcEncodeInput,
): readonly WebRemoteControlRpcFrame[] {
  const identity = parseWebRemoteControlRpcIdentity(input);
  assertPositiveSafeRpcInteger(input.firstPhysicalSeq, "remote.rpcFrame.invalidPhysicalSeq");
  assertPositiveSafeRpcInteger(input.messageSeq, "remote.rpcFrame.invalidMessageSeq");
  const maxPhysicalFrameBytes = boundedPositiveRpcLimit(
    input.maxPhysicalFrameBytes,
    WEB_REMOTE_CONTROL_RPC_LIMITS.maxPhysicalFrameBytes,
    "remote.rpcFrame.invalidPhysicalLimit",
  );
  const maxMessageBytes = boundedPositiveRpcLimit(
    input.maxMessageBytes,
    WEB_REMOTE_CONTROL_RPC_LIMITS.maxMessageBytes,
    "remote.rpcFrame.invalidMessageLimit",
  );
  const maxFragments = boundedPositiveRpcLimit(
    input.maxFragments,
    WEB_REMOTE_CONTROL_RPC_LIMITS.maxFragments,
    "remote.rpcFrame.invalidFragmentLimit",
  );
  if (bytes.byteLength === 0) {
    throw new WebRemoteControlRpcTransportEncodingError("remote.rpcFrame.emptyMessage");
  }
  if (bytes.byteLength > maxMessageBytes) {
    throw new WebRemoteControlRpcTransportEncodingError("remote.rpcFrame.messageTooLarge");
  }
  const checksum = Object.freeze({
    algorithm: "crc32" as const,
    value: crc32WireBytes(bytes),
  });
  let fragmentCount = 1;
  let budget = 0;
  for (;;) {
    const endSeq = input.firstPhysicalSeq + fragmentCount - 1;
    if (!Number.isSafeInteger(endSeq) || endSeq > Number.MAX_SAFE_INTEGER) {
      throw new WebRemoteControlRpcTransportEncodingError("remote.rpcFrame.sequenceOverflow");
    }
    budget = findDecodedBudget({
      identity,
      endSeq,
      messageSeq: input.messageSeq,
      fragmentCount,
      messageBytes: bytes.byteLength,
      checksum,
      maxPhysicalFrameBytes,
    });
    if (budget < 1) {
      throw new WebRemoteControlRpcTransportEncodingError("remote.rpcFrame.envelopeTooLarge");
    }
    const needed = Math.ceil(bytes.byteLength / budget);
    if (needed > maxFragments) {
      throw new WebRemoteControlRpcTransportEncodingError("remote.rpcFrame.fragmentLimitExceeded");
    }
    if (needed <= fragmentCount) break;
    fragmentCount = needed;
  }
  const frames: WebRemoteControlRpcFrame[] = [];
  for (let index = 0; index < fragmentCount; index += 1) {
    const start = index * budget;
    const end = Math.min(bytes.byteLength, start + budget);
    const frame = frameShell({
      identity,
      seq: input.firstPhysicalSeq + index,
      messageSeq: input.messageSeq,
      fragmentIndex: index,
      fragmentCount,
      messageBytes: bytes.byteLength,
      checksum,
      dataBase64: encodeWireBytesBase64(bytes.subarray(start, end)),
    });
    if (
      measureWebRemoteControlRpcRelayEnvelopeBytes(frame) > maxPhysicalFrameBytes ||
      !webRemoteControlRpcFrameSchema.safeParse(frame).success
    ) {
      throw new WebRemoteControlRpcTransportEncodingError("remote.rpcFrame.internalEnvelopeError");
    }
    frames.push(Object.freeze(frame));
  }
  return Object.freeze(frames);
}

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

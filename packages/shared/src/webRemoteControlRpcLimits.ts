import { PROTOCOL_V4_LIMITS } from "./zcode-protocol-v4/core.js";

/** 发布包 `Ne`：物理帧上限沿用 v4 maxFrameBytes，消息本体单独 16MiB。 */
export const WEB_REMOTE_CONTROL_RPC_LIMITS = {
  maxPhysicalFrameBytes: PROTOCOL_V4_LIMITS.maxFrameBytes,
  maxMessageBytes: 16 * 1024 * 1024,
  maxFragments: 64,
  assemblyTimeoutMs: 30_000,
  transportIdMaxChars: PROTOCOL_V4_LIMITS.transportEnvelopeIdMaxChars,
} as const;

export class WebRemoteControlRpcTransportEncodingError extends Error {
  readonly reasonCode: string;

  constructor(reasonCode: string) {
    super(reasonCode);
    this.name = "WebRemoteControlRpcTransportEncodingError";
    this.reasonCode = reasonCode;
  }
}

export function assertPositiveSafeRpcInteger(value: number, reasonCode: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new WebRemoteControlRpcTransportEncodingError(reasonCode);
  }
}

export function boundedPositiveRpcLimit(
  value: number | undefined,
  ceiling: number,
  reasonCode: string,
): number {
  const resolved = value ?? ceiling;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new WebRemoteControlRpcTransportEncodingError(reasonCode);
  }
  return Math.min(resolved, ceiling);
}

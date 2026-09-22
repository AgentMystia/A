import { z } from "zod";
import {
  crc32WireBytes,
  decodeWireBase64,
  encodeWireBytesBase64,
} from "./zcode-protocol-v4/wire-binary.js";
import {
  WEB_REMOTE_CONTROL_RPC_LIMITS,
  WebRemoteControlRpcTransportEncodingError,
} from "./webRemoteControlRpcLimits.js";

const limits = WEB_REMOTE_CONTROL_RPC_LIMITS;

export const webRemoteControlPositiveSafeIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export const webRemoteControlNonnegativeSafeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const webRemoteControlTransportIdSchema = z
  .string()
  .min(1)
  .max(limits.transportIdMaxChars)
  .regex(/^[A-Za-z0-9._~-]+$/u);

export const webRemoteControlRpcIdentitySchema = z
  .object({
    bridgeSessionId: webRemoteControlTransportIdSchema,
    bridgeGeneration: webRemoteControlNonnegativeSafeIntegerSchema.optional(),
    recoveryId: webRemoteControlTransportIdSchema.optional(),
  })
  .strict();

export type WebRemoteControlRpcIdentity = z.infer<typeof webRemoteControlRpcIdentitySchema>;

const checksumSchema = z
  .object({
    algorithm: z.literal("crc32"),
    value: z.string().regex(/^[0-9a-f]{8}$/u),
  })
  .strict();

export function isCanonicalWebRemoteControlBase64(value: string): boolean {
  if (value.length < 4 || value.length > limits.maxPhysicalFrameBytes) return false;
  const decoded = decodeWireBase64(value);
  return decoded !== null && decoded.byteLength > 0 && encodeWireBytesBase64(decoded) === value;
}

export const webRemoteControlRpcFrameSchema = z
  .object({
    zcode_type: z.literal("rpc-frame"),
    bridgeSessionId: webRemoteControlTransportIdSchema,
    bridgeGeneration: webRemoteControlNonnegativeSafeIntegerSchema.optional(),
    recoveryId: webRemoteControlTransportIdSchema.optional(),
    seq: webRemoteControlPositiveSafeIntegerSchema,
    messageSeq: webRemoteControlPositiveSafeIntegerSchema,
    fragmentIndex: z
      .number()
      .int()
      .nonnegative()
      .max(limits.maxFragments - 1),
    fragmentCount: z.number().int().positive().max(limits.maxFragments),
    messageBytes: z.number().int().positive().max(limits.maxMessageBytes),
    checksum: checksumSchema,
    dataBase64: z
      .string()
      .min(4)
      .max(limits.maxPhysicalFrameBytes)
      .refine(isCanonicalWebRemoteControlBase64),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.fragmentIndex >= frame.fragmentCount) {
      context.addIssue({
        code: "custom",
        path: ["fragmentIndex"],
        message: "fragmentIndex must be smaller than fragmentCount",
      });
    }
    if (frame.fragmentCount > frame.messageBytes) {
      context.addIssue({
        code: "custom",
        path: ["fragmentCount"],
        message: "non-empty fragments cannot exceed message bytes",
      });
    }
  });

export const webRemoteControlRpcAckSchema = z
  .object({
    zcode_type: z.literal("rpc-frame-ack"),
    bridgeSessionId: webRemoteControlTransportIdSchema,
    bridgeGeneration: webRemoteControlNonnegativeSafeIntegerSchema.optional(),
    recoveryId: webRemoteControlTransportIdSchema.optional(),
    ackMessageSeq: webRemoteControlPositiveSafeIntegerSchema,
  })
  .strict();

export const webRemoteControlRpcTransportPayloadSchema = z.union([
  webRemoteControlRpcFrameSchema,
  webRemoteControlRpcAckSchema,
]);

export type WebRemoteControlRpcFrame = z.infer<typeof webRemoteControlRpcFrameSchema>;
export type WebRemoteControlRpcAck = z.infer<typeof webRemoteControlRpcAckSchema>;
export type WebRemoteControlRpcTransportPayload = z.infer<
  typeof webRemoteControlRpcTransportPayloadSchema
>;

export function parseWebRemoteControlRpcIdentity(
  value: WebRemoteControlRpcIdentity,
): WebRemoteControlRpcIdentity {
  const parsed = webRemoteControlRpcIdentitySchema.safeParse({
    bridgeSessionId: value.bridgeSessionId,
    ...(value.bridgeGeneration === undefined ? {} : { bridgeGeneration: value.bridgeGeneration }),
    ...(value.recoveryId === undefined ? {} : { recoveryId: value.recoveryId }),
  });
  if (!parsed.success) {
    throw new WebRemoteControlRpcTransportEncodingError("remote.rpcFrame.invalidIdentity");
  }
  return parsed.data;
}

export function parseWebRemoteControlRpcTransportPayload(
  value: unknown,
): WebRemoteControlRpcTransportPayload | null {
  const parsed = webRemoteControlRpcTransportPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function hasWebRemoteControlRawIdentityMismatch(
  identity: WebRemoteControlRpcIdentity,
  value: unknown,
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const mentionsIdentity = ["bridgeSessionId", "bridgeGeneration", "recoveryId"].some(
    (key) => key in record,
  );
  if (!mentionsIdentity) return false;
  return (
    record.bridgeSessionId !== identity.bridgeSessionId ||
    record.bridgeGeneration !== identity.bridgeGeneration ||
    record.recoveryId !== identity.recoveryId
  );
}

export function sameWebRemoteControlRpcIdentity(
  identity: WebRemoteControlRpcIdentity,
  frame: { bridgeSessionId: string; bridgeGeneration?: number; recoveryId?: string },
): boolean {
  return (
    frame.bridgeSessionId === identity.bridgeSessionId &&
    frame.bridgeGeneration === identity.bridgeGeneration &&
    frame.recoveryId === identity.recoveryId
  );
}

export interface WebRemoteControlFrameFingerprint {
  messageSeq: number;
  value: string;
}

export function webRemoteControlFrameFingerprint(
  frame: WebRemoteControlRpcFrame,
  bytes: Uint8Array,
): WebRemoteControlFrameFingerprint {
  return {
    messageSeq: frame.messageSeq,
    value: JSON.stringify([
      frame.bridgeSessionId,
      frame.bridgeGeneration ?? null,
      frame.recoveryId ?? null,
      frame.seq,
      frame.messageSeq,
      frame.fragmentIndex,
      frame.fragmentCount,
      frame.messageBytes,
      frame.checksum.algorithm,
      frame.checksum.value,
      bytes.byteLength,
      crc32WireBytes(bytes),
    ]),
  };
}

export function sameWebRemoteControlFrameFingerprint(
  left: WebRemoteControlFrameFingerprint,
  right: WebRemoteControlFrameFingerprint,
): boolean {
  return left.value === right.value;
}

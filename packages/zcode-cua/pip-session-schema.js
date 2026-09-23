import { z } from "zod";

// 发布包把这份 zod 留在 main paths、host index、scheduler index。
// 客户端在 host 里调用 event schema 的 parse；另外三个对象没有调用方，靠副作用留下来。
// 协议版本和 runtime id 不在这里，避免 main / scheduler 摇进 `zcode-cua-pip-session-v2`。

const RESERVED_PIP_IDENTIFIER = "__zcode_pip_no_active_session_v2__";

const pipIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !value.includes("\0"), "identifier cannot contain NUL")
  .refine(
    (value) => value !== RESERVED_PIP_IDENTIFIER,
    "identifier is reserved by the PiP session runtime",
  );

const pipNonNegativeIntSchema = z.number().int().nonnegative().safe();

export const pipSessionEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("focus-changed"),
      revision: pipNonNegativeIntSchema,
      sourceWindowId: pipIdentifierSchema,
      sessionId: pipIdentifierSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("turn-started"),
      sessionId: pipIdentifierSchema,
      turnId: pipIdentifierSchema,
      sequenceNumber: pipNonNegativeIntSchema,
      eventId: pipIdentifierSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("turn-ended"),
      sessionId: pipIdentifierSchema,
      turnId: pipIdentifierSchema,
      sequenceNumber: pipNonNegativeIntSchema,
      eventId: pipIdentifierSchema,
      outcome: z.enum(["completed", "failed"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("session-closed"),
      sessionId: pipIdentifierSchema,
      sequenceNumber: pipNonNegativeIntSchema,
      eventId: pipIdentifierSchema,
    })
    .strict(),
]);

export const pipSessionWindowSchema = z
  .object({
    windowId: z.number().int().positive().safe(),
    presentationWindowId: z.number().int().positive().safe().optional(),
    pid: z.number().int().positive().safe(),
    bundleId: z.string().trim().min(1).max(255),
  })
  .strict();

export const pipSessionHandshakeSchema = z
  .object({
    protocolVersion: z.number().int(),
    runtimeId: z.string(),
  })
  .strict();

export const pipSessionEventEnvelopeSchema = z
  .object({
    event: pipSessionEventSchema,
  })
  .strict();

import type { ConversationTelemetryFact } from "@zcode/shared/zcode-protocol-v4";
import type { ParityOperation } from "@/v4/telemetry/conversationTelemetryParityModel.js";

export interface ParityScopeClock {
  now: number;
  sequence: number;
}

function factBase(scope: ParityScopeClock, operation: ParityOperation) {
  return {
    version: 1 as const,
    eventId: operation.eventId ?? "",
    eventSeq: scope.sequence++,
    occurredAt: operation.now ?? scope.now,
    sessionId: operation.sessionId ?? "",
    ...(operation.commandId ? { sourceCommandId: operation.commandId } : {}),
    ...(operation.turnId ? { turnId: operation.turnId } : {}),
  };
}

function modelStatus(
  status: string | undefined,
): Extract<ConversationTelemetryFact, { kind: "model.request.status" }>["status"] {
  switch (status) {
    case "model_request_completed":
    case "model_request_failed":
    case "model_retry_scheduled":
    case "model_stream_stalled":
      return status;
    default:
      return "model_request_started";
  }
}

function terminalStatus(
  status: string | undefined,
): Extract<ConversationTelemetryFact, { kind: "turn.terminal" }>["status"] {
  if (status === "interrupted" || status === "failed") return status;
  return "success";
}

function toolPhase(
  phase: string | undefined,
): Extract<ConversationTelemetryFact, { kind: "tool.lifecycle" }>["phase"] {
  if (
    phase === "scheduled" ||
    phase === "progress" ||
    phase === "completed" ||
    phase === "failed"
  ) {
    return phase;
  }
  return "started";
}

function permissionPhase(
  phase: string | undefined,
): Extract<ConversationTelemetryFact, { kind: "permission.lifecycle" }>["phase"] {
  if (phase === "resolved" || phase === "denied") return phase;
  return "requested";
}

export function buildParityPromptFact(
  scope: ParityScopeClock,
  operation: ParityOperation,
): ConversationTelemetryFact {
  const base = factBase(scope, operation);
  switch (operation.kind) {
    case "turn.started":
      return { ...base, kind: "turn.started", executionKind: "agent" };
    case "model.status":
      return {
        ...base,
        kind: "model.request.status",
        requestId: operation.requestId ?? "",
        status: modelStatus(operation.status),
        providerId: operation.providerId ?? "",
        modelId: operation.modelId ?? "",
        ...(operation.providerHostname ? { providerHostname: operation.providerHostname } : {}),
        transport: "fetch",
        querySource: "main_turn",
        queryId: `${operation.requestId}-query`,
        attempt: 1,
        maxAttempts: 3,
        ...(operation.durationMs === undefined ? {} : { durationMs: operation.durationMs }),
        ...(operation.reason === undefined ? {} : { reason: operation.reason }),
        ...(operation.retryable === undefined ? {} : { retryable: operation.retryable }),
        ...(operation.statusCode === undefined ? {} : { statusCode: operation.statusCode }),
        ...(operation.delayMs === undefined ? {} : { delayMs: operation.delayMs }),
        ...(operation.nextAttempt === undefined ? {} : { nextAttempt: operation.nextAttempt }),
        ...(operation.idleMs === undefined ? {} : { idleMs: operation.idleMs }),
        ...(operation.timeoutMs === undefined ? {} : { timeoutMs: operation.timeoutMs }),
      };
    case "chunk":
      return {
        ...base,
        kind: "stream.chunk",
        channel: operation.channel === "thought" ? "thought" : "text",
        chunkLength: 1,
        firstChunk: operation.firstChunk === true,
        assistantMessageId: `${operation.commandId}-assistant`,
        ...(operation.parentToolCallId ? { parentToolCallId: operation.parentToolCallId } : {}),
      };
    case "permission":
      return {
        ...base,
        kind: "permission.lifecycle",
        phase: permissionPhase(operation.phase),
        ...(operation.requestId ? { requestId: operation.requestId } : {}),
        toolCallId: operation.toolCallId ?? "",
        toolName: "Bash",
        ...(operation.decision === "allow" ||
        operation.decision === "deny" ||
        operation.decision === "escalate" ||
        operation.decision === "modify"
          ? { decision: operation.decision }
          : {}),
      };
    case "tool":
      return {
        ...base,
        kind: "tool.lifecycle",
        phase: toolPhase(operation.phase),
        toolCallId: operation.toolCallId ?? "",
        ...(operation.toolName ? { toolName: operation.toolName } : {}),
        ...(operation.errorCode ? { errorCode: operation.errorCode } : {}),
        ...(operation.errorMessage ? { errorMessage: operation.errorMessage } : {}),
        ...(operation.parentToolCallId ? { parentToolCallId: operation.parentToolCallId } : {}),
        ...(operation.performance ? { performance: operation.performance } : {}),
      };
    case "usage":
      return {
        ...base,
        kind: "usage.delta",
        inputTokens: operation.inputTokens ?? 0,
        outputTokens: operation.outputTokens ?? 0,
        totalTokens: (operation.inputTokens ?? 0) + (operation.outputTokens ?? 0),
        reasoningTokens: operation.reasoningTokens ?? 0,
        cacheReadTokens: operation.cacheReadTokens ?? 0,
        cacheWriteTokens: operation.cacheWriteTokens ?? 0,
      };
    case "terminal":
      return {
        ...base,
        kind: "turn.terminal",
        status: terminalStatus(operation.status),
        ...(operation.errorCode ? { errorCode: operation.errorCode } : {}),
        ...(operation.errorMessage ? { errorMessage: operation.errorMessage } : {}),
      };
    default:
      return { ...base, kind: "turn.started", executionKind: "agent" };
  }
}

export function buildParityCompactionFact(
  scope: ParityScopeClock,
  operation: ParityOperation,
): Extract<ConversationTelemetryFact, { kind: "compaction.terminal" }> {
  const status =
    operation.status === "failed" || operation.status === "interrupted"
      ? operation.status
      : "completed";
  const trigger =
    operation.trigger === "auto" ||
    operation.trigger === "partial" ||
    operation.trigger === "reactive" ||
    operation.trigger === "session_memory"
      ? operation.trigger
      : "manual";
  return {
    version: 1,
    eventId: operation.eventId ?? "",
    eventSeq: scope.sequence++,
    occurredAt: operation.now ?? scope.now,
    sessionId: operation.sessionId ?? "",
    kind: "compaction.terminal",
    operationId: operation.operationId ?? "",
    ...(operation.summaryMessageId ? { summaryMessageId: operation.summaryMessageId } : {}),
    status,
    trigger,
    ...(operation.compactReason ? { compactReason: operation.compactReason } : {}),
    ...(operation.reason ? { reason: operation.reason } : {}),
    attempt: 1,
    ...(operation.startedAt === undefined ? {} : { startedAt: operation.startedAt }),
    ...(operation.endedAt === undefined ? {} : { endedAt: operation.endedAt }),
    ...(operation.preCompactTokenCount === undefined
      ? {}
      : { preCompactTokenCount: operation.preCompactTokenCount }),
    ...(operation.postCompactTokenCount === undefined
      ? {}
      : { postCompactTokenCount: operation.postCompactTokenCount }),
    ...(operation.truePostCompactTokenCount === undefined
      ? {}
      : { truePostCompactTokenCount: operation.truePostCompactTokenCount }),
    ...(operation.modelName ? { modelName: operation.modelName } : {}),
    ...(operation.modelProvider ? { modelProvider: operation.modelProvider } : {}),
  };
}

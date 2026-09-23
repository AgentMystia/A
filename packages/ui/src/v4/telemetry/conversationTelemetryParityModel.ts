import { BUILTIN_MODEL_PROVIDER_IDS } from "@zcode/shared";
import { decodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { parseCustomProviderIdFromSupplierKey } from "@/lib/modelConfigSync.js";
import {
  buildSessionQuotaBannerDismissKey,
  buildSessionQuotaBannerState,
} from "@/v4/sessionQuotaBannerState.js";

export const PARITY_PROMPT_SEED = {
  askMode: "build",
  modelName: "glm-model",
  modelProvider: "glm",
  providerHostname: "api.example.com",
} as const;

export interface ParityToolPerformance {
  totalMs?: number;
  permissionWaitMs?: number;
  commandRunMs?: number;
  exitCode?: number;
  timedOut?: boolean;
  outputBytes?: number;
  commandCategory?: string;
  commandHash?: string;
  workspaceKind?: "local" | "remote" | "unknown";
}

export interface ParityOperation {
  kind: string;
  scope?: string;
  sessionId?: string;
  commandId?: string;
  turnId?: string;
  owner?: string;
  now?: number;
  value?: string;
  eventId?: string;
  askMode?: string;
  modelName?: string;
  modelProvider?: string;
  providerHostname?: string;
  requestId?: string;
  status?: string;
  providerId?: string;
  modelId?: string;
  reason?: string;
  retryable?: boolean;
  statusCode?: number;
  delayMs?: number;
  nextAttempt?: number;
  idleMs?: number;
  timeoutMs?: number;
  durationMs?: number;
  channel?: "text" | "thought";
  firstChunk?: boolean;
  parentToolCallId?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  errorCode?: string;
  errorMessage?: string;
  phase?: string;
  toolCallId?: string;
  toolName?: string;
  decision?: string;
  performance?: ParityToolPerformance;
  operationId?: string;
  summaryMessageId?: string;
  trigger?: string;
  compactReason?: string;
  startedAt?: number;
  endedAt?: number;
  preCompactTokenCount?: number;
  postCompactTokenCount?: number;
  truePostCompactTokenCount?: number;
  duplicate?: boolean;
  errorKey?: string;
  displayMessage?: string;
  code?: string;
  traceId?: string;
  detail?: string;
  suppressed?: boolean;
  messageId?: string;
  reaction?: string;
  operations?: ParityOperation[];
}

export interface ConversationTelemetryParityCase {
  caseId: string;
  operations: ParityOperation[];
  minimumReportInventory: Record<string, number>;
  minimumArmsInventory: Record<string, number>;
  proof: readonly string[];
}

export interface StandardParitySequenceInput {
  caseId: string;
  sessionId?: string;
  commandId?: string;
  sendAt?: number;
  chunkAt?: number;
  terminalAt?: number;
  scope?: string;
  includeNetwork?: boolean;
}

export function parityPartId(caseId: string, part: string): string {
  return `${caseId.toLowerCase()}-${part}`;
}

export function buildStandardParitySequence(input: StandardParitySequenceInput): ParityOperation[] {
  const sessionId = input.sessionId ?? parityPartId(input.caseId, "session");
  const commandId = input.commandId ?? parityPartId(input.caseId, "command");
  const turnId = parityPartId(input.caseId, "turn");
  const sendAt = input.sendAt ?? 100;
  const chunkAt = input.chunkAt ?? 200;
  const terminalAt = input.terminalAt ?? 300;
  const scope = input.scope;
  const started: ParityOperation[] =
    input.includeNetwork === false
      ? []
      : [
          {
            kind: "model.status",
            now: sendAt + 10,
            eventId: parityPartId(input.caseId, "request-started"),
            sessionId,
            commandId,
            turnId,
            requestId: parityPartId(input.caseId, "request"),
            status: "model_request_started",
            providerId: "glm",
            modelId: "glm-model",
            providerHostname: "api.example.com",
            scope,
          },
        ];
  const completed: ParityOperation[] =
    input.includeNetwork === false
      ? []
      : [
          {
            kind: "model.status",
            now: terminalAt - 5,
            eventId: parityPartId(input.caseId, "request-completed"),
            sessionId,
            commandId,
            turnId,
            requestId: parityPartId(input.caseId, "request"),
            status: "model_request_completed",
            providerId: "glm",
            modelId: "glm-model",
            providerHostname: "api.example.com",
            durationMs: terminalAt - sendAt - 15,
            scope,
          },
        ];
  return [
    {
      kind: "foreground.attach",
      sessionId,
      owner: parityPartId(input.caseId, "owner"),
      scope,
    },
    { kind: "focus", now: sendAt - 20, scope },
    { kind: "text", now: sendAt - 10, value: "x", scope },
    {
      kind: "seed",
      sessionId,
      commandId,
      now: sendAt,
      ...PARITY_PROMPT_SEED,
      scope,
    },
    {
      kind: "turn.started",
      now: sendAt + 5,
      eventId: parityPartId(input.caseId, "started"),
      sessionId,
      commandId,
      turnId,
      scope,
    },
    ...started,
    {
      kind: "chunk",
      now: chunkAt,
      eventId: parityPartId(input.caseId, "chunk"),
      sessionId,
      commandId,
      turnId,
      channel: "text",
      firstChunk: true,
      scope,
    },
    {
      kind: "usage",
      now: terminalAt - 10,
      eventId: parityPartId(input.caseId, "usage"),
      sessionId,
      commandId,
      turnId,
      inputTokens: 10,
      outputTokens: 5,
      scope,
    },
    ...completed,
    {
      kind: "terminal",
      now: terminalAt,
      eventId: parityPartId(input.caseId, "terminal"),
      sessionId,
      commandId,
      turnId,
      status: "success",
      scope,
    },
  ];
}

export function defineParityCase(
  caseId: string,
  operations: ParityOperation[],
  minimumReportInventory: Record<string, number>,
  minimumArmsInventory: Record<string, number>,
  proof: readonly string[],
): ConversationTelemetryParityCase {
  return { caseId, operations, minimumReportInventory, minimumArmsInventory, proof };
}

function readConfigSelectValue(
  options: readonly { category?: string; type?: string; currentValue?: unknown }[],
  category: string,
): string | null {
  const match = options.find((option) => option.category === category && option.type === "select");
  const currentValue = typeof match?.currentValue === "string" ? match.currentValue.trim() : "";
  return currentValue || null;
}

function readProviderIdFromModelValue(modelValue: string | null | undefined): string | null {
  const normalized = modelValue?.trim() ?? "";
  if (!normalized) return null;
  const custom = decodeCustomModelValue(normalized);
  if (custom?.providerId) return custom.providerId;
  const slash = normalized.indexOf("/");
  if (slash <= 0) return null;
  return normalized.slice(0, slash).trim() || null;
}

/** 发布包 Ftn：配置里的 model、supplier key，再退回 taskMeta.model。 */
export function resolveConversationTelemetryParityProviderId(input: {
  configOptions?: readonly { category?: string; type?: string; currentValue?: unknown }[] | null;
  selectedSupplierKey?: string | null;
  taskMeta?: { model?: string | null } | null;
}): string | null {
  return (
    readProviderIdFromModelValue(
      input.configOptions ? readConfigSelectValue(input.configOptions, "model") : null,
    ) ||
    (input.selectedSupplierKey
      ? parseCustomProviderIdFromSupplierKey(input.selectedSupplierKey)
      : null) ||
    readProviderIdFromModelValue(input.taskMeta?.model)
  );
}

export function assertParityState(ok: boolean, label: string, labels: string[]): void {
  if (!ok) {
    throw new Error(`conversation telemetry parity state assertion failed: ${label}`);
  }
  labels.push(label);
}

export function collectQuotaParityAssertions(): string[] {
  const labels: string[] = [];
  const providerId = BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan;
  const daily = buildSessionQuotaBannerState({
    activeProviderId: providerId,
    snapshot: null,
    modelId: "glm-5.2",
    serverQuotaExhausted: true,
  });
  assertParityState(
    daily.visible && daily.kind === "daily-exhausted" && !daily.dismissible,
    "quota:daily-exhausted",
    labels,
  );
  const concurrent = buildSessionQuotaBannerState({
    activeProviderId: providerId,
    snapshot: null,
    modelId: "glm-5.2",
    serverConcurrentLimited: true,
    serverConcurrentLimitBusinessCode: "3010",
    serverConcurrentLimitReason: "retry-exhausted-busy",
  });
  assertParityState(
    concurrent.kind === "concurrent-limit" &&
      concurrent.dismissible &&
      !concurrent.blocksSubmit &&
      concurrent.priority === 60,
    "quota:concurrent-dismissible-nonblocking",
    labels,
  );
  const limited = buildSessionQuotaBannerState({
    activeProviderId: providerId,
    snapshot: null,
    modelId: "glm-5.2",
    serverProviderLimitedBusinessCode: "1308",
    serverProviderLimitedMessage: "[1308][余额不足][request-id]",
  });
  assertParityState(
    limited.kind === "provider-limited" && limited.providerLimitedMessage === "余额不足",
    "quota:provider-limited-message",
    labels,
  );
  assertParityState(
    buildSessionQuotaBannerDismissKey(concurrent, "error-a") !==
      buildSessionQuotaBannerDismissKey(concurrent, "error-b"),
    "quota:dismiss-key-instance",
    labels,
  );
  return labels;
}

export function collectCaptchaParityAssertions(): string[] {
  const labels: string[] = [];
  assertParityState(
    resolveConversationTelemetryParityProviderId({
      taskMeta: { model: `${BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan}/glm-5.2` },
    }) === BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
    "captcha:exact-provider",
    labels,
  );
  return labels;
}

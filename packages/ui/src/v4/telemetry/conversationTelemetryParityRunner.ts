import type { IPlatformService } from "@zcode/shared";
import { reportAppTelemetryEvent } from "@/lib/appTelemetry.js";
import { resetMessageTelemetryStateForParity } from "@/lib/messageTelemetry.js";
import { setUiPerfArmsReporter } from "@/lib/uiPerfArmsTelemetry.js";
import { ConversationTelemetrySupervisor } from "@/v4/telemetry/conversationTelemetrySupervisor.js";
import { lookupConversationTelemetryParityCase } from "@/v4/telemetry/conversationTelemetryParityCatalog.js";
import {
  buildParityCompactionFact,
  buildParityPromptFact,
  type ParityScopeClock,
} from "@/v4/telemetry/conversationTelemetryParityFacts.js";
import {
  collectCaptchaParityAssertions,
  collectQuotaParityAssertions,
  type ParityOperation,
} from "@/v4/telemetry/conversationTelemetryParityModel.js";

export type ConversationTelemetryParityPlatform = Pick<
  IPlatformService,
  "reportArmsCustomEvent" | "reportTelemetryEvent"
>;

export interface ConversationTelemetryParityRunResult {
  caseId: string;
  minimumArmsInventory: Record<string, number>;
  minimumReportInventory: Record<string, number>;
  operationCount: number;
  proof: readonly string[];
  stateAssertions: string[];
}

interface ParityScope extends ParityScopeClock {
  foregroundOwners: Map<string, object>;
  supervisor: ConversationTelemetrySupervisor;
}

interface DispatchContext {
  caseId: string;
  getScope: (scopeName?: string) => ParityScope;
  operation: ParityOperation;
  platform: ConversationTelemetryParityPlatform;
  stateAssertions: string[];
  visibleErrorKeys: Set<string>;
}

function createScope(
  platform: ConversationTelemetryParityPlatform,
  workspaceScopeKey: string,
): ParityScope {
  // supervisor.now 必须读到同一对象上随后被用例改写的时钟。
  const scope = {
    now: 0,
    sequence: 0,
    foregroundOwners: new Map<string, object>(),
  } as ParityScope;
  scope.supervisor = new ConversationTelemetrySupervisor({
    platform,
    workspaceScopeKey,
    now: () => scope.now,
  });
  return scope;
}

function rememberLabel(labels: string[], label: string): void {
  if (!labels.includes(label)) labels.push(label);
}

async function runWebNoop(
  context: DispatchContext,
  operations: readonly ParityOperation[],
): Promise<void> {
  const noopPlatform: ConversationTelemetryParityPlatform = {
    reportTelemetryEvent: async () => undefined,
    reportArmsCustomEvent: async () => undefined,
  };
  const scopes = new Map<string, ParityScope>();
  const getScope = (scopeName = "web") => {
    const existing = scopes.get(scopeName);
    if (existing) return existing;
    const created = createScope(
      noopPlatform,
      `telemetry-parity\u0000${context.caseId}\u0000web\u0000${scopeName}`,
    );
    scopes.set(scopeName, created);
    return created;
  };
  setUiPerfArmsReporter(null);
  try {
    for (const operation of operations) {
      await dispatchOperation({ ...context, getScope, operation, platform: noopPlatform });
    }
    await Promise.all([...scopes.values()].map((scope) => scope.supervisor.flushReportsForTest()));
  } finally {
    for (const scope of scopes.values()) {
      await scope.supervisor.flushReportsForTest();
      scope.supervisor.dispose();
    }
    setUiPerfArmsReporter(context.platform);
  }
}

async function dispatchOperation(context: DispatchContext): Promise<void> {
  const { operation } = context;
  if (operation.kind === "web.noop") {
    await runWebNoop(context, operation.operations ?? []);
    rememberLabel(context.stateAssertions, "web:no-final-output");
    return;
  }
  if (operation.kind === "quota.assert") {
    context.stateAssertions.push(...collectQuotaParityAssertions());
    return;
  }
  if (operation.kind === "captcha.assert") {
    context.stateAssertions.push(...collectCaptchaParityAssertions());
    return;
  }
  const scope = context.getScope(operation.scope);
  if ("now" in operation && typeof operation.now === "number") {
    scope.now = operation.now;
  }
  switch (operation.kind) {
    case "focus":
      scope.supervisor.recordComposerFocus();
      return;
    case "text":
      scope.supervisor.recordComposerTextChange(operation.value ?? "");
      return;
    case "seed":
      scope.supervisor.acceptPromptSeed({
        sessionId: operation.sessionId ?? "",
        sourceCommandId: operation.commandId ?? "",
        sendTime: operation.now ?? scope.now,
        extraDetail: {
          ask_mode: operation.askMode ?? "",
          model_name: operation.modelName ?? "",
          model_provider: operation.modelProvider ?? "",
          ...(operation.providerHostname ? { provider_name: operation.providerHostname } : {}),
          agent: "glm",
          plan_status: "unknown",
          plan_product_id: "",
        },
      });
      return;
    case "foreground.attach": {
      const owner = scope.foregroundOwners.get(operation.owner ?? "") ?? {};
      scope.foregroundOwners.set(operation.owner ?? "", owner);
      scope.supervisor.attachForeground(owner, operation.sessionId ?? "");
      return;
    }
    case "foreground.detach": {
      const owner = scope.foregroundOwners.get(operation.owner ?? "");
      if (owner) scope.supervisor.attachForeground(owner, `detached:${operation.owner ?? ""}`);
      return;
    }
    case "compaction":
      scope.supervisor.handleFact(buildParityCompactionFact(scope, operation));
      return;
    case "visible.error":
      if (operation.suppressed || context.visibleErrorKeys.has(operation.errorKey ?? "")) return;
      context.visibleErrorKeys.add(operation.errorKey ?? "");
      scope.supervisor.reportVisibleChatError({
        errorKey: operation.errorKey,
        displayMessage: operation.displayMessage ?? "",
        error: {
          code: operation.code ?? "",
          message: operation.displayMessage ?? "",
          ...(operation.traceId ? { traceId: operation.traceId } : {}),
          ...(operation.sessionId ? { taskId: operation.sessionId } : {}),
          ...(operation.detail ? { detail: operation.detail } : {}),
        },
      });
      return;
    case "feedback":
      await reportAppTelemetryEvent(
        context.platform,
        {
          elementName: "assistant_message_feedback",
          eventRegion: "chat",
          eventType: "ck",
          eventExtraDetail: { reaction: operation.reaction ?? "" },
          ...(operation.sessionId ? { talkId: operation.sessionId } : {}),
          ...(operation.messageId ? { messageId: operation.messageId } : {}),
        },
        "conversation-telemetry-parity-e2e",
      );
      return;
    case "scope.dispose":
      await scope.supervisor.flushReportsForTest();
      scope.supervisor.dispose();
      return;
    default:
      scope.supervisor.handleFact(buildParityPromptFact(scope, operation));
  }
}

export async function runConversationTelemetryParityCase(
  platform: ConversationTelemetryParityPlatform,
  caseId: string,
): Promise<ConversationTelemetryParityRunResult> {
  const entry = lookupConversationTelemetryParityCase(caseId);
  resetMessageTelemetryStateForParity();
  const scopes = new Map<string, ParityScope>();
  const stateAssertions: string[] = [];
  const visibleErrorKeys = new Set<string>();
  const getScope = (scopeName = "default") => {
    const existing = scopes.get(scopeName);
    if (existing) return existing;
    const created = createScope(platform, `telemetry-parity\u0000${caseId}\u0000${scopeName}`);
    scopes.set(scopeName, created);
    return created;
  };
  try {
    for (const operation of entry.operations) {
      await dispatchOperation({
        caseId,
        getScope,
        operation,
        platform,
        stateAssertions,
        visibleErrorKeys,
      });
    }
    await Promise.all([...scopes.values()].map((scope) => scope.supervisor.flushReportsForTest()));
    return {
      caseId,
      minimumArmsInventory: entry.minimumArmsInventory,
      minimumReportInventory: entry.minimumReportInventory,
      operationCount: entry.operations.length,
      proof: entry.proof,
      stateAssertions,
    };
  } finally {
    for (const scope of scopes.values()) {
      await scope.supervisor.flushReportsForTest();
      scope.supervisor.dispose();
    }
  }
}

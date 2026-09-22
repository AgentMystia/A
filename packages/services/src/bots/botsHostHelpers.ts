import {
  decodeCustomModelValue,
  encodeCustomModelValue,
  generateTraceId,
  isFeishuBotProvider,
  type BotActor,
  type BotDraftOptions,
  type ZCodeBotDeliveryTarget,
  type ZCodeConfigOption,
  type BotWorkspaceRef,
  type ModelSelection,
  type TraceId,
} from "@zcode/shared";
import { DEFAULT_DRAFT_PROVIDER } from "./botsConstants.js";
import type { BotSelection, BotSelectionOption } from "./botsTypes.js";

const ZCODE_TASK_PROVIDERS = ["codex", "claude", "opencode", "gemini", "glm"] as const;
const PERSISTED_SESSION_MODES = new Set([
  "default",
  "yolo",
  "plan",
  "edit",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
  "autoEdit",
  "build",
]);

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 发布包 host `getModeConfigOption`：只认 category=mode 的 select。 */
export function getModeConfigOption(
  options: ZCodeConfigOption[],
): ZCodeConfigOption | undefined {
  return options.find((option) => option.category === "mode" && option.type === "select");
}

/** 发布包 host `normalizePersistedSessionMode`。 */
export function normalizePersistedSessionMode(
  modeId: string | undefined,
  provider: string | undefined,
): string | undefined {
  const mode = readTrimmedString(modeId);
  if (!mode) return undefined;
  if (PERSISTED_SESSION_MODES.has(mode)) return mode;
  switch (mode) {
    case "read-only":
    case "read_only":
      return "plan";
    case "auto_edit":
    case "auto-edit":
    case "autoEdit":
    case "accept_edits":
    case "accept-edits":
      return "acceptEdits";
    case "full-auto":
    case "full_auto":
      return "yolo";
    case "agent":
      return provider === "codex" ? "default" : undefined;
    case "agent-full-access":
    case "agent_full_access":
    case "full-access":
    case "full_access":
      return "bypassPermissions";
    default:
      return undefined;
  }
}

/** 发布包 host `resolveProviderModeIdFromConfigOptions`。 */
export function resolveProviderModeIdFromConfigOptions(input: {
  configOptions: ZCodeConfigOption[];
  modeId: string | undefined;
  provider: string | undefined;
}): string | undefined {
  const modeId = readTrimmedString(input.modeId);
  if (!modeId) return undefined;
  const options = getModeConfigOption(input.configOptions)?.options ?? [];
  const exact = options.find((option) => option.value === modeId);
  if (exact) return exact.value;
  const normalized = normalizePersistedSessionMode(modeId, input.provider);
  return normalized
    ? options.find(
        (option) => normalizePersistedSessionMode(option.value, input.provider) === normalized,
      )?.value
    : undefined;
}

export type BotTaskProvider = (typeof ZCODE_TASK_PROVIDERS)[number];

/** 发布包 host `ho`：草稿 provider 只允许 botDraftOptions 枚举，缺省 glm。 */
export function toBotTaskProvider(provider: string | undefined): BotTaskProvider {
  return ZCODE_TASK_PROVIDERS.includes(provider as BotTaskProvider)
    ? (provider as BotTaskProvider)
    : DEFAULT_DRAFT_PROVIDER;
}

/** 发布包 host `normalizeBotDraftOptions`（keepNames `St`）。 */
export function normalizeRecoveredBotDraftOptions(options: BotDraftOptions): BotDraftOptions {
  return { ...options, provider: toBotTaskProvider(options.provider) };
}

/** 发布包 host `formatBotModelSelectionValue`：glm 只展示 modelId。 */
export function formatBotModelSelectionValue(selection: ModelSelection | undefined): string | undefined {
  if (!selection) {
    return undefined;
  }
  return selection.providerId === "glm"
    ? selection.modelId
    : `${selection.providerId}/${selection.modelId}`;
}

/** 发布包 host `parseBotModelOptionValue`。 */
export function parseBotModelOptionValue(
  value: string,
): { providerId: string; modelId: string } | undefined {
  const custom = decodeCustomModelValue(value);
  if (custom?.providerId && custom.modelName) {
    return { providerId: custom.providerId, modelId: custom.modelName };
  }
  const slash = value.indexOf("/");
  if (slash > 0 && slash < value.length - 1) {
    return { providerId: value.slice(0, slash), modelId: value.slice(slash + 1) };
  }
  const trimmed = value.trim();
  return trimmed ? { providerId: DEFAULT_DRAFT_PROVIDER, modelId: trimmed } : undefined;
}

/** 发布包 host `getNativeModelProviderId`。 */
export function getNativeModelProviderId(provider: string): string {
  return `native:${provider}`;
}

/** 发布包 host `resolveCustomModelRuntimeModelId`。 */
export function resolveCustomModelRuntimeModelId(
  provider: string,
  custom: { providerId: string; modelName?: string },
): string | undefined {
  if (!custom.modelName) {
    return undefined;
  }
  return provider === "opencode"
    ? encodeCustomModelValue(custom.providerId, custom.modelName)
    : custom.modelName;
}

/** 发布包 host `createTraceId` / `an(taskId)`。 */
export function createBotTraceId(taskId: string): TraceId {
  return generateTraceId(taskId);
}

/** 发布包 host `taskStatus`。 */
export function taskStatus(task: { status?: string | null }): string {
  return task.status ?? "running";
}

/** 发布包 host `formatStatusTaskLine`。 */
export function formatStatusTaskLine(task: { title: string; taskId: string }, label = "Task"): string {
  return `${label}: ${task.title} (${task.taskId})`;
}

/** 发布包 host `deriveSessionTitle`。 */
export function deriveSessionTitle(
  content: string,
  attachments: Array<{ filename: string }>,
): string {
  if (content.length > 0) {
    return content.slice(0, 50) + (content.length > 50 ? "..." : "");
  }
  const first = attachments[0];
  if (!first) {
    return "";
  }
  const extra = attachments.length - 1;
  return extra > 0 ? `${first.filename} +${extra}` : first.filename;
}

/** 发布包 host `resolveAutomationBotDeliveryTarget`。 */
export function resolveAutomationBotDeliveryTarget(
  actor: BotActor,
): ZCodeBotDeliveryTarget | undefined {
  if (actor.provider !== "feishu" && actor.provider !== "lark" && actor.provider !== "weixin") {
    return undefined;
  }
  const providerUserId = actor.chatId?.trim() || actor.providerUserId.trim();
  // 发布包会返回缺省 chatType，JSON 序列化会丢掉该字段，strict schema 随后拒绝整条 prompt。
  // 没有 private|group 时不发送投递目标。
  if (!providerUserId || (actor.chatType !== "private" && actor.chatType !== "group")) {
    return undefined;
  }
  return {
    provider: actor.provider,
    botId: actor.botId,
    providerUserId,
    chatType: actor.chatType,
  };
}

/** 发布包 host `resolveOptionByValue`。 */
export function resolveOptionByValue<T extends { id: string; label: string }>(
  options: T[],
  value: string,
): T | null {
  const trimmed = value.trim();
  if (/^[1-9]\d*$/u.test(trimmed)) {
    return options[Number.parseInt(trimmed, 10) - 1] ?? null;
  }
  const token = trimmed.toLowerCase();
  return options.find((option) => option.id.toLowerCase() === token || option.label.toLowerCase() === token) ?? null;
}

export function isSelectionIndexValue(value: string): boolean {
  return /^[1-9]\d*$/u.test(value.trim());
}

/** 发布包 host `formatWorkspaceOptionLabel`。 */
export function formatWorkspaceOptionLabel(workspace: BotWorkspaceRef, locale: string): string {
  if (!workspace.workspaceIdentity) {
    return workspace.label;
  }
  const tag = locale === "en-US" ? "[Remote]" : "[远端]";
  return `${workspace.label} ${tag}`;
}

/** 发布包 host `isFeishuBotProvider`（keepNames `er`）。 */
export { isFeishuBotProvider };

export function findSelectConfigOption(
  options: Array<{ type: string; category?: string; id: string }>,
  configId: string,
): { type: string; category?: string; id: string; currentValue?: unknown; options?: Array<{ value: string; name: string; description?: string }> } | undefined {
  const category = configId === "thoughtLevel" ? "thought_level" : configId;
  return options.find((option) => option.type === "select" && (option.category === category || option.id === category));
}

export function getConfigCommandMissingMessageId(configId: string): "modeMissing" | "thoughtLevelMissing" {
  return configId === "mode" ? "modeMissing" : "thoughtLevelMissing";
}

export function stripModelProviderDescriptionsForTextSelection(selection: BotSelection): BotSelection {
  if (selection.action !== "model.provider.set") {
    return selection;
  }
  return {
    ...selection,
    options: selection.options.map((option) => ({ ...option, description: undefined })),
  };
}

export function formatSelectionFallback(selection: BotSelection, locale: "zh-CN" | "en-US", textHint: string, textHintNoCancel: string): string {
  const lines = selection.options.map((option, index) => {
    const description = option.description ? ` ${option.description}` : "";
    return `${index + 1}. ${option.label}${description}`;
  });
  if (selection.showCancel === false) {
    return `${selection.title}\n${lines.join("\n")}\n\n${textHintNoCancel}`;
  }
  const cancel = selection.cancelLabel ?? "取消";
  return `${selection.title}\n0. ${cancel}\n${lines.join("\n")}\n\n${textHint}`;
}

export function toSelectionOptions(
  options: BotSelectionOption[],
): BotSelectionOption[] {
  return options;
}

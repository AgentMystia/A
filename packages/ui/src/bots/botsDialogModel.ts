import { createDefaultBotsConfig } from "@zcode/shared/botsDefaults";
import {
  ALL_WORKSPACES,
  BOT_BIND_CODE_TTL_MS,
  BOT_REPLY_MODES,
  DEFAULT_BOT_COMMAND_POLICY,
  DEFAULT_BOT_REPLY_MODE,
  getSupportedBotReplyGranularities,
  normalizeBotReplyGranularity,
  type BotConfigEntry,
  type BotProviderId,
  type BotReplyMode,
  type BotRuntimeStatus,
} from "@zcode/shared";

/** 发布包 styles 里 Telegram 凭证区指向的 BotFather 地址。 */
export const TELEGRAM_BOT_FATHER_URL = "https://t.me/BotFather";

export { BOT_BIND_CODE_TTL_MS, createDefaultBotsConfig };

/** 远控弹窗只打开这四个已实现渠道。 */
export const WEB_REMOTE_BOT_CHANNELS = [
  { provider: "weixin" },
  { provider: "feishu" },
  { provider: "lark" },
  { provider: "telegram" },
] as const satisfies ReadonlyArray<{ provider: BotProviderId }>;

export type NewBotCatalogId = BotProviderId | "dingding";

export const NEW_BOT_CATALOG: ReadonlyArray<{ id: NewBotCatalogId; implemented: boolean }> = [
  { id: "weixin", implemented: true },
  { id: "feishu", implemented: true },
  { id: "lark", implemented: true },
  { id: "telegram", implemented: true },
  { id: "dingding", implemented: false },
  { id: "discord", implemented: false },
  { id: "wecom", implemented: false },
  { id: "webhook", implemented: true },
];

const REPLY_GRANULARITY_OPTIONS = [
  {
    id: "assistant_changes",
    labelId: "bots.replyGranularity.assistantChanges",
    descriptionId: "bots.replyGranularity.assistantChanges.description",
  },
  {
    id: "assistant_toolcalls_changes",
    labelId: "bots.replyGranularity.assistantToolcallsChanges",
    descriptionId: "bots.replyGranularity.assistantToolcallsChanges.description",
  },
  {
    id: "summary_changes",
    labelId: "bots.replyGranularity.summaryChanges",
    descriptionId: "bots.replyGranularity.summaryChanges.description",
  },
  {
    id: "streaming_card",
    labelId: "bots.replyGranularity.streamingCard",
    descriptionId: "bots.replyGranularity.streamingCard.description",
  },
] as const satisfies ReadonlyArray<{ id: BotReplyMode; labelId: string; descriptionId: string }>;

export function botChannelRegionTag(provider: string): string | null {
  if (provider === "lark") return "login.oauth.regionTag.zai";
  if (provider === "feishu") return "login.oauth.regionTag.bigmodel";
  return null;
}

export function allowsAllWorkspaces(allowed: readonly string[]): boolean {
  return allowed.length === 0 || allowed.includes(ALL_WORKSPACES);
}

export function botDisplayName(name: string, fallback: string): string {
  return name.trim() || fallback;
}

export function botWorkspaceKey(workspacePath: string, workspaceIdentity?: string): string {
  return workspaceIdentity?.trim() || workspacePath;
}

export function bindCountdownLabel(remainingMs: number): string {
  return `${Math.max(0, Math.ceil(remainingMs / 1000))}s`;
}

export function runtimeErrorCode(message: string | undefined): string | undefined {
  return message?.match(/\b\d{7,}\b/)?.[0];
}

export function runtimeDotClass(runtime: BotRuntimeStatus | undefined, enabled: boolean): string {
  if (runtime?.status === "error") return "bg-destructive";
  if (runtime?.status === "polling" || runtime?.status === "connected") return "bg-success";
  return enabled ? "bg-foreground-subtle" : "bg-border";
}

export function runtimeStatusText(
  runtime: BotRuntimeStatus | undefined,
  enabled: boolean,
  formatMessageId: ((id: string) => string) | undefined,
): string {
  if (runtime?.messageId && formatMessageId) return formatMessageId(runtime.messageId);
  return runtime?.message ?? runtime?.status ?? (enabled ? "enabled" : "disabled");
}

export function replyGranularityOptions(provider: BotProviderId) {
  const supported = new Set(getSupportedBotReplyGranularities(provider));
  return REPLY_GRANULARITY_OPTIONS.filter((option) => supported.has(option.id));
}

export function currentReplyGranularity(provider: BotProviderId, replyMode: BotReplyMode) {
  const options = replyGranularityOptions(provider);
  return options.find((option) => option.id === replyMode) ?? options[0]!;
}

export function isBotReplyMode(value: string): value is BotReplyMode {
  return (BOT_REPLY_MODES as readonly string[]).includes(value);
}

export function createBotDraft(provider: BotProviderId): BotConfigEntry {
  return {
    id: `bot-${crypto.randomUUID()}`,
    name: "",
    provider,
    enabled: true,
    allowedWorkspaces: [ALL_WORKSPACES],
    allowedCommands: DEFAULT_BOT_COMMAND_POLICY,
    currentOptions: {},
    replyMode: normalizeBotReplyGranularity(provider, DEFAULT_BOT_REPLY_MODE),
  };
}

export function bindCodeRequest(bot: Pick<BotConfigEntry, "id" | "allowedWorkspaces">) {
  return {
    botId: bot.id,
    ttlMs: BOT_BIND_CODE_TTL_MS,
    allowedWorkspaces: bot.allowedWorkspaces,
  };
}

export function selectOrCreateBot(
  bots: readonly BotConfigEntry[],
  provider: BotProviderId,
): { mode: "select"; botId: string } | { mode: "create"; provider: BotProviderId } {
  const existing = bots.find((bot) => bot.provider === provider);
  return existing ? { mode: "select", botId: existing.id } : { mode: "create", provider };
}

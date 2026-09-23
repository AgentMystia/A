import { z } from "zod";
import { modelSelectionSchema } from "./model-selection.js";

/** 发布包 host 的全 workspace 授权字面量。 */
export const ALL_WORKSPACES = "*" as const;

/** 发布包 host 绑定码默认 TTL。 */
export const BOT_BIND_CODE_TTL_MS = 30_000;

/** 发布包任务列表广播频道。host 与 renderer 都引用这一份。 */
export const BOT_TASK_LIST_CHANNEL = "bots:task";

/** 发布包任务流广播频道。每条流事件先走这里，再走列表频道。 */
export const BOT_TASK_STREAM_CHANNEL = "bots:task-stream";

/** 发布包不允许这些 provider 的启用 bot 共享同一 credential。 */
export const BOT_POLLING_PROVIDERS = ["telegram", "feishu", "lark"] as const;

export const BOT_PROVIDERS = [
  "telegram",
  "webhook",
  "feishu",
  "lark",
  "weixin",
  "discord",
  "wecom",
] as const;

export type BotProviderId = (typeof BOT_PROVIDERS)[number];

export const BOT_REPLY_MODES = [
  "assistant_changes",
  "assistant_toolcalls_changes",
  "summary_changes",
  "streaming_card",
] as const;

export type BotReplyMode = (typeof BOT_REPLY_MODES)[number];

export const DEFAULT_BOT_REPLY_MODE: BotReplyMode = "assistant_changes";

export const botCommandPolicySchema = z
  .object({
    status: z.boolean(),
    new: z.boolean(),
    workspace: z.boolean(),
    model: z.boolean(),
    mode: z.boolean().optional(),
    thoughtLevel: z.boolean(),
    sandboxMode: z.boolean().optional(),
    approvalPolicy: z.boolean().optional(),
    cli: z.boolean().optional(),
    reply: z.boolean(),
  })
  .strict();

export type BotCommandPolicy = z.infer<typeof botCommandPolicySchema>;

export const DEFAULT_BOT_COMMAND_POLICY: BotCommandPolicy = {
  status: true,
  new: true,
  workspace: true,
  model: true,
  mode: true,
  thoughtLevel: true,
  reply: true,
};

export const botCurrentOptionsSchema = z
  .object({
    modelSelection: modelSelectionSchema.optional(),
    mode: z.string().min(1).optional(),
    sandboxMode: z.string().min(1).optional(),
    approvalPolicy: z.string().min(1).optional(),
    cli: z.enum(["codex", "claude", "opencode", "gemini", "glm"]).optional(),
  })
  .strict();

export type BotCurrentOptions = z.infer<typeof botCurrentOptionsSchema>;

export const botDraftOptionsSchema = z
  .object({
    provider: z.enum(["codex", "claude", "opencode", "gemini", "glm"]),
    modelSelection: modelSelectionSchema.optional(),
    mode: z.string().min(1).optional(),
  })
  .strict();

export type BotDraftOptions = z.infer<typeof botDraftOptionsSchema>;

export const botConfigEntrySchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    provider: z.enum(BOT_PROVIDERS),
    enabled: z.boolean(),
    credentialRef: z.string().min(1).optional(),
    webhookSecretRef: z.string().min(1).optional(),
    webhookUrl: z.string().url().optional(),
    webhookAuthHeaderName: z.string().min(1).optional(),
    feishuAppId: z.string().min(1).optional(),
    providerUserId: z.string().min(1).optional(),
    displayName: z.string().optional(),
    allowedWorkspaces: z.array(z.string().min(1)),
    allowedCommands: botCommandPolicySchema,
    currentOptions: botCurrentOptionsSchema,
    replyMode: z.enum([
      "assistant_changes",
      "assistant_toolcalls_changes",
      "summary_changes",
      "streaming_card",
    ]),
  })
  .strict();

export type BotConfigEntry = z.infer<typeof botConfigEntrySchema>;

export const botsConfigSchema = z
  .object({
    version: z.literal(3),
    bots: z.array(botConfigEntrySchema),
  })
  .strict();

export type BotsConfig = z.infer<typeof botsConfigSchema>;

export const botPermissionResponseSchema = z
  .object({
    decision: z.enum(["allow", "deny", "escalate", "modify"]),
    reason: z.string().optional(),
    modifiedInput: z.unknown().optional(),
    permissionUpdates: z.array(z.unknown()).optional(),
  })
  .strict();

export const botPendingPermissionOptionSchema = z.object({
  requestId: z.string().min(1),
  optionId: z.string().min(1),
  command: z.enum(["approve", "deny"]),
  label: z.string().min(1),
  response: botPermissionResponseSchema,
  handledAt: z.number().optional(),
});

export const botElicitationOptionSchema = z
  .object({
    value: z.string(),
    label: z.string(),
    description: z.string().optional(),
  })
  .strict();

export const botElicitationQuestionSchema = z
  .object({
    question: z.string(),
    header: z.string(),
    options: z.array(botElicitationOptionSchema),
    multiSelect: z.boolean().optional(),
  })
  .strict();

export const botPendingElicitationSchema = z
  .object({
    taskId: z.string().min(1),
    requestId: z.string().min(1),
    runId: z.string().min(1),
    origin: z.unknown().optional(),
    actorKey: z.string().min(1).optional(),
    currentQuestionIndex: z.number().int().min(0),
    questions: z.array(botElicitationQuestionSchema),
    answers: z.record(z.string(), z.array(z.string())),
    renderContext: z
      .object({
        kind: z.literal("plan_approval"),
        plan: z.string().min(1),
      })
      .strict()
      .optional(),
    expandedCustomAnswerQuestionIndexes: z.array(z.number().int().min(0)).optional(),
    handledAt: z.number().optional(),
  })
  .strict();

export const botRuntimeStateSchema = z.object({
  botId: z.string().min(1),
  workspacePath: z.string().min(1),
  workspaceIdentity: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  mode: z.enum(["draft", "task"]),
  activeTaskId: z.string().min(1).nullable(),
  draftOptions: botDraftOptionsSchema.optional(),
  pendingPermissionOptions: z.array(botPendingPermissionOptionSchema).optional(),
  pendingElicitation: botPendingElicitationSchema.optional(),
  telegramOffset: z.number().optional(),
  weixinGetUpdatesBuf: z.string().optional(),
  weixinActivatedAt: z.number().optional(),
  updatedAt: z.number(),
});

export type BotRuntimeState = z.infer<typeof botRuntimeStateSchema>;

export const botsStateSchema = z
  .object({
    version: z.literal(3),
    bots: z.record(z.string(), botRuntimeStateSchema),
  })
  .strict();

export type BotsState = z.infer<typeof botsStateSchema>;

export function createDefaultBotsConfig(): BotsConfig {
  return { version: 3, bots: [] };
}

export function createDefaultBotsState(): BotsState {
  return { version: 3, bots: {} };
}

export function isFeishuBotProvider(provider: BotProviderId): boolean {
  return provider === "feishu" || provider === "lark";
}

export function getSupportedBotReplyGranularities(provider: BotProviderId): BotReplyMode[] {
  // 发布包 chunk keepNames：飞书/Lark 只保留 streaming_card，其余 provider 去掉该粒度。
  if (isFeishuBotProvider(provider)) {
    return ["streaming_card"];
  }
  return BOT_REPLY_MODES.filter((mode) => mode !== "streaming_card");
}

export function normalizeBotReplyGranularity(
  provider: BotProviderId,
  replyMode?: BotReplyMode,
): BotReplyMode {
  const supported = getSupportedBotReplyGranularities(provider);
  const candidate = replyMode ?? "assistant_changes";
  return supported.includes(candidate) ? candidate : supported[0]!;
}

export function buildBotCredentialKey(botId: string): string {
  return `bot:${botId}:credential`;
}

export function buildBotWebhookSecretKey(botId: string): string {
  return `bot:${botId}:webhook-secret`;
}

export interface BotRuntimeStatus {
  botId: string;
  provider: BotProviderId;
  status: "idle" | "disabled" | string;
  message?: string;
  messageId?: string;
  offset?: number;
  deliveryError?: string;
  lastUpdateAt?: number;
}

export interface BotsServiceStatus {
  botsCount: number;
  enabledBotsCount: number;
  contextsCount: number;
  botRuntime: BotRuntimeStatus[];
}

export interface SaveBotRequest {
  bot: BotConfigEntry;
  credentialValue?: string;
  webhookSecretValue?: string;
}

export interface BotTestResult {
  ok: boolean;
  message: string;
  name?: string;
  provider: BotProviderId;
}

export interface BotBindCodeResult {
  code: string;
  expiresAt: number;
}

export interface BotWorkspaceRef {
  id: string;
  label: string;
  workspacePath: string;
  workspaceIdentity?: string;
}

export interface BotActor {
  provider: BotProviderId;
  botId: string;
  providerUserId: string;
  displayName?: string;
  chatType?: "private" | "group";
  chatId?: string;
  providerMessageId?: string;
  providerContextToken?: string;
}

export interface BotOutboundMessage {
  actor: BotActor;
  text: string;
  selection?: unknown;
  elicitation?: unknown;
  locale?: "zh-CN" | "en-US";
}

export interface BotInboundMessage {
  botId: string;
  text: string;
  actor: BotActor;
  attachments?: unknown[];
  elicitationResponse?: unknown;
}

export interface BotProviderOutbound {
  botId: string;
  provider: BotProviderId;
  providerUserId: string;
  text: string;
  selection?: unknown;
  elicitation?: unknown;
  locale?: "zh-CN" | "en-US";
  providerContextToken?: string;
  providerMessageId?: string;
}

export interface BotAutomationRunWatch {
  target: {
    botId: string;
    provider: BotProviderId;
    providerUserId: string;
    chatType?: "private" | "group";
  };
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
}

export interface BotProviderCallbackResult {
  ok: boolean;
  replies: BotOutboundMessage[];
  status?: number;
  responseBody?: unknown;
}

export interface FeishuRegistrationBegin {
  deviceCode: string;
  qrUrl: string;
  userCode: string;
  interval: number;
  expiresAt: number;
  domain: "feishu" | "lark";
  pollDomain: "feishu" | "lark";
}

export type FeishuRegistrationPoll =
  | {
      status: "pending";
      interval: number;
      domain: string;
      pollDomain?: "feishu" | "lark";
    }
  | {
      status: "success";
      appId: string;
      appSecret: string;
      domain: string;
      appName?: string;
      openId?: string;
    }
  | { status: "access_denied"; domain: string }
  | { status: "expired"; domain: string }
  | { status: "error"; message: string; domain: string };

export interface WeixinRegistrationBegin {
  qrCode: string;
  qrUrl: string;
  interval: number;
  expiresAt: number;
}

export type WeixinRegistrationPoll =
  | { status: "pending" | "scanned"; interval?: number }
  | { status: "success"; botToken: string; botId?: string }
  | { status: "expired" }
  | { status: "error"; message: string };

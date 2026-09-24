import {
  ALL_WORKSPACES,
  BOT_POLLING_PROVIDERS,
  DEFAULT_BOT_COMMAND_POLICY,
  botCurrentOptionsSchema,
  botDraftOptionsSchema,
  isFeishuBotProvider,
  decodeCustomModelValue,
  migrateLegacyModelProviderId,
  migrateLegacyOfficialGlmModelId,
  modelSelectionSchema,
  normalizeBotReplyGranularity,
  type BotCommandPolicy,
  type BotConfigEntry,
  type BotCurrentOptions,
  type BotDraftOptions,
  type BotProviderId,
  type BotsConfig,
  type BotRuntimeState,
  type BotWorkspaceRef,
} from "@zcode/shared";

const POLLING_PROVIDERS = new Set<string>(BOT_POLLING_PROVIDERS);

export function getWorkspaceKey(workspacePath: string, workspaceIdentity?: string): string {
  return workspaceIdentity?.trim() || workspacePath;
}

export function getWorkspaceLabel(workspacePath: string): string {
  return workspacePath.split(/[\\/]/u).filter(Boolean).at(-1) ?? workspacePath;
}

export function createWorkspaceRef(
  workspacePath: string,
  workspaceIdentity?: string,
): BotWorkspaceRef {
  return {
    id: getWorkspaceKey(workspacePath, workspaceIdentity),
    label: getWorkspaceLabel(workspacePath),
    workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
  };
}

export function isAllWorkspacesAllowed(allowed: string[]): boolean {
  return allowed.length === 0 || allowed.includes(ALL_WORKSPACES);
}

export function normalizeAllowedWorkspaces(allowed: string[]): string[] {
  const trimmed = allowed.map((item) => item.trim()).filter(Boolean);
  return isAllWorkspacesAllowed(trimmed) ? [ALL_WORKSPACES] : [...new Set(trimmed)];
}

export function isWorkspaceAllowed(workspaceId: string, allowed: string[]): boolean {
  return isAllWorkspacesAllowed(allowed) || allowed.includes(workspaceId);
}

export function filterAllowedWorkspaces(
  workspaces: BotWorkspaceRef[],
  allowed: string[],
): BotWorkspaceRef[] {
  return isAllWorkspacesAllowed(allowed)
    ? workspaces
    : workspaces.filter((workspace) => allowed.includes(workspace.id));
}

export function firstAllowedWorkspace(
  workspaces: BotWorkspaceRef[],
  bot: Pick<BotConfigEntry, "allowedWorkspaces">,
): BotWorkspaceRef | null {
  return filterAllowedWorkspaces(workspaces, bot.allowedWorkspaces)[0] ?? null;
}

/** 发布包 host `resolveCanonicalContextWorkspace`。 */
export function resolveCanonicalContextWorkspace(
  context: Pick<BotRuntimeState, "workspacePath" | "workspaceIdentity" | "workspaceId">,
  workspaces: BotWorkspaceRef[],
): BotWorkspaceRef | null {
  const key = getWorkspaceKey(context.workspacePath, context.workspaceIdentity);
  const matched = workspaces.find(
    (workspace) => getWorkspaceKey(workspace.workspacePath, workspace.workspaceIdentity) === key,
  );
  if (matched) {
    return matched;
  }
  if (context.workspaceId) {
    const byId = workspaces.find((workspace) => workspace.id === context.workspaceId);
    if (byId) {
      return byId;
    }
  }
  if (context.workspaceIdentity) {
    return null;
  }
  const byPath = workspaces.filter((workspace) => workspace.workspacePath === context.workspacePath);
  return byPath.length === 1 ? (byPath[0] ?? null) : null;
}

/** 发布包 host `resolveCanonicalWorkspaceId`。 */
export function resolveCanonicalWorkspaceId(
  value: string | undefined,
  workspaces: BotWorkspaceRef[],
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const byPath = workspaces.filter((workspace) => workspace.workspacePath === trimmed);
  const byId = workspaces.find((workspace) => workspace.id === trimmed);
  if (byId) {
    const remotes = byPath.filter((workspace) => workspace.workspaceIdentity);
    return !byId.workspaceIdentity && remotes.length === 1 ? remotes[0]!.id : byId.id;
  }
  return byPath.length === 1 ? byPath[0]!.id : trimmed;
}

/** 发布包 host `normalizeConfiguredAllowedWorkspaces`。 */
export function normalizeConfiguredAllowedWorkspaces(
  allowed: string[],
  workspaces: BotWorkspaceRef[],
): string[] {
  const normalized = normalizeAllowedWorkspaces(allowed);
  return isAllWorkspacesAllowed(normalized)
    ? [ALL_WORKSPACES]
    : [...new Set(normalized.map((item) => resolveCanonicalWorkspaceId(item, workspaces) ?? item))];
}

/** 发布包 host `resolveWorkspaceByValue`。 */
export function resolveWorkspaceByValue(
  workspaces: BotWorkspaceRef[],
  value: string,
  allowed: string[],
): BotWorkspaceRef | null {
  const trimmed = value.trim();
  const listed = filterAllowedWorkspaces(workspaces, allowed);
  const index = Number.parseInt(trimmed, 10);
  if (Number.isFinite(index) && index > 0) {
    return listed[index - 1] ?? null;
  }
  const token = trimmed.toLowerCase();
  return (
    listed.find(
      (workspace) =>
        workspace.id.toLowerCase() === token ||
        workspace.label.toLowerCase() === token ||
        workspace.workspacePath === trimmed ||
        getWorkspaceKey(workspace.workspacePath, workspace.workspaceIdentity) === trimmed,
    ) ?? null
  );
}

export function findBot(config: BotsConfig, botId: string): BotConfigEntry | null {
  return config.bots.find((bot) => bot.id === botId) ?? null;
}

export function normalizeBotCommandPolicy(
  policy: Partial<BotCommandPolicy> = {},
): BotCommandPolicy {
  return {
    ...DEFAULT_BOT_COMMAND_POLICY,
    status: policy.status ?? DEFAULT_BOT_COMMAND_POLICY.status,
    new: policy.new ?? DEFAULT_BOT_COMMAND_POLICY.new,
    workspace: policy.workspace ?? DEFAULT_BOT_COMMAND_POLICY.workspace,
    model: policy.model ?? DEFAULT_BOT_COMMAND_POLICY.model,
    mode: policy.mode ?? DEFAULT_BOT_COMMAND_POLICY.mode,
    thoughtLevel: policy.thoughtLevel ?? DEFAULT_BOT_COMMAND_POLICY.thoughtLevel,
    sandboxMode: policy.sandboxMode ?? DEFAULT_BOT_COMMAND_POLICY.sandboxMode,
    approvalPolicy: policy.approvalPolicy ?? DEFAULT_BOT_COMMAND_POLICY.approvalPolicy,
    reply: policy.reply ?? DEFAULT_BOT_COMMAND_POLICY.reply,
  };
}

export function normalizeBotCurrentOptions(
  options: Partial<BotCurrentOptions> = {},
): BotCurrentOptions {
  const parsed = modelSelectionSchema.safeParse(options.modelSelection);
  return {
    ...(parsed.success ? { modelSelection: parsed.data } : {}),
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.sandboxMode ? { sandboxMode: options.sandboxMode } : {}),
    ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
  };
}

export function normalizeBotDraftOptions(options: BotDraftOptions): BotDraftOptions {
  const parsed = modelSelectionSchema.safeParse(options.modelSelection);
  return botDraftOptionsSchema.parse({
    provider: options.provider,
    ...(parsed.success ? { modelSelection: parsed.data } : {}),
    ...(options.mode ? { mode: options.mode } : {}),
  });
}

export function migrateSelection(value: Record<string, unknown>): BotCurrentOptions["modelSelection"] {
  // 发布包把 builtin: 旧身份改成正式 provider，并用原来的 provider 规范官方 GLM 模型名。
  // 已经是正式选择时原样返回。无法映射的 builtin: 丢掉，避免旧 ID 写进 bot config。
  if (Object.hasOwn(value, "modelSelection")) {
    const parsed = modelSelectionSchema.safeParse(value.modelSelection);
    if (!parsed.success) {
      return undefined;
    }
    const selection = parsed.data;
    if (!selection.providerId.startsWith("builtin:")) {
      return selection;
    }
    const providerId = migrateLegacyModelProviderId(selection.providerId);
    return providerId
      ? {
          ...selection,
          providerId,
          modelId: migrateLegacyOfficialGlmModelId(selection.providerId, selection.modelId),
        }
      : undefined;
  }
  const model = typeof value.model === "string" ? value.model.trim() : "";
  const decoded = decodeCustomModelValue(model);
  const slash = model.indexOf("/");
  const legacyProviderId = decoded?.providerId ?? (slash > 0 ? model.slice(0, slash) : undefined);
  const legacyModelId = decoded?.modelName ?? (slash > 0 ? model.slice(slash + 1) : undefined);
  if (!legacyProviderId || !legacyModelId) {
    return undefined;
  }
  const providerId = migrateLegacyModelProviderId(legacyProviderId);
  if (!providerId) {
    return undefined;
  }
  const thoughtLevel = typeof value.thoughtLevel === "string" ? value.thoughtLevel.trim() : "";
  return {
    providerId,
    modelId: migrateLegacyOfficialGlmModelId(legacyProviderId, legacyModelId),
    ...(thoughtLevel ? { options: { reasoningLevel: thoughtLevel } } : {}),
  };
}

export function importLegacyBotConfig(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.bots)) {
    return value;
  }
  return {
    ...value,
    version: 3,
    bots: value.bots.map((bot) => {
      if (!isRecord(bot)) {
        return bot;
      }
      const currentOptions = isRecord(bot.currentOptions) ? bot.currentOptions : {};
      return {
        ...bot,
        currentOptions: normalizeBotCurrentOptions({
          ...currentOptions,
          modelSelection: migrateSelection(currentOptions),
        }),
      };
    }),
  };
}

export function importLegacyBotState(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.bots)) {
    return value;
  }
  const bots = Object.entries(value.bots).map(([botId, state]) => {
    if (!isRecord(state) || !isRecord(state.draftOptions)) {
      return [botId, state] as const;
    }
    const draft = state.draftOptions;
    return [
      botId,
      {
        ...state,
        draftOptions: normalizeBotDraftOptions({
          provider: "glm",
          modelSelection: migrateSelection(draft),
          ...(typeof draft.mode === "string" ? { mode: draft.mode } : {}),
        }),
      },
    ] as const;
  });
  return { ...value, version: 3, bots: Object.fromEntries(bots) };
}

export function normalizeBotConfig(bot: BotConfigEntry): BotConfigEntry {
  const normalized: BotConfigEntry = {
    ...bot,
    allowedWorkspaces: normalizeAllowedWorkspaces(bot.allowedWorkspaces),
    allowedCommands: normalizeBotCommandPolicy(bot.allowedCommands),
    currentOptions: botCurrentOptionsSchema.parse(normalizeBotCurrentOptions(bot.currentOptions)),
    replyMode: normalizeBotReplyGranularity(bot.provider, bot.replyMode),
  };
  if (normalized.provider === "weixin") {
    delete normalized.webhookUrl;
  }
  return normalized;
}

export function normalizeConfigBots(config: BotsConfig): BotsConfig {
  return { ...config, bots: config.bots.map(normalizeBotConfig) };
}

export function isUserCommandAllowed(
  bot: BotConfigEntry,
  command: string,
): boolean {
  if (["help", "message", "approve", "task", "stop"].includes(command)) {
    return true;
  }
  if (command === "reconnect") {
    return normalizeBotCommandPolicy(bot.allowedCommands).workspace !== false;
  }
  const policy = normalizeBotCommandPolicy(bot.allowedCommands) as Record<string, boolean | undefined>;
  return policy[command] !== false;
}

export function validateBotConfig(config: BotsConfig, bot: BotConfigEntry): void {
  if (!bot.id.trim()) {
    throw new Error("Bot id is required.");
  }
  if (
    bot.enabled &&
    bot.providerUserId?.trim() &&
    config.bots.find(
      (other) =>
        other.id !== bot.id &&
        other.enabled &&
        other.provider === bot.provider &&
        other.providerUserId === bot.providerUserId,
    )
  ) {
    throw new Error("An enabled bot with this provider user already exists.");
  }
  if (
    bot.enabled &&
    bot.credentialRef?.trim() &&
    POLLING_PROVIDERS.has(bot.provider) &&
    config.bots.find(
      (other) =>
        other.id !== bot.id &&
        other.enabled &&
        other.provider === bot.provider &&
        other.credentialRef === bot.credentialRef,
    )
  ) {
    throw new Error("Enabled polling bots cannot share the same credential.");
  }
}

export function findAuthorizedBot(
  config: BotsConfig,
  actor: { provider: BotProviderId; botId: string; providerUserId: string },
): BotConfigEntry | null {
  // 发布包按 enabled+provider+botId 找 bot。未绑定用户不能在这里用 providerUserId 过滤，
  // 否则 /help、/status 会误报 botDisabled，而不是后续 findBoundUser 的 userNotBound。
  return (
    config.bots.find(
      (bot) => bot.enabled && bot.provider === actor.provider && bot.id === actor.botId,
    ) ?? null
  );
}

export function findBoundUser(
  bot: BotConfigEntry,
  actor: { provider: BotProviderId; providerUserId: string },
): BotConfigEntry | null {
  return actor.provider === "weixin" || bot.providerUserId === actor.providerUserId ? bot : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export { isFeishuBotProvider };

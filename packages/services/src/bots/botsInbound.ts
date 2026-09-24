import {
  type BotActor,
  type BotConfigEntry,
  type BotInboundMessage,
  type BotOutboundMessage,
  type BotProviderOutbound,
  type BotRuntimeState,
  type BotsConfig,
  isFeishuBotProvider,
  normalizeBotReplyGranularity,
} from "@zcode/shared";
import type { ISettingService } from "../setting/setting.js";
import { normalizeBotMessageLocale, type BotMessageLocale } from "./botsCopy.js";
import { copy, createWorkspaceRefCache, buildHelpText } from "./botsInboundText.js";
import {
  findAuthorizedBot,
  findBoundUser,
  firstAllowedWorkspace,
  isUserCommandAllowed,
  isWorkspaceAllowed,
  normalizeConfiguredAllowedWorkspaces,
  resolveCanonicalContextWorkspace,
} from "./botsNormalize.js";
import { createOutbound, toOutboundMessages } from "./botsOutbound.js";
import { handleBotReconnect } from "./botsInboundReconnect.js";
import { handleBind as bindBot } from "./botsInboundBind.js";
import {
  formatReplyGranularityLabel,
  getReplyGranularityOptions,
  parseReplyGranularity,
} from "./botsReply.js";
import type { IBotRemoteWorkspaceService } from "./botsRemoteWorkspace.js";
import type { BotsRepo } from "./botsRepo.js";
import type { BotSelection } from "./botsTypes.js";
import { buildInitializedDraftOptions } from "./botsDraft.js";
import { isRemoteWorkspaceConnected, writeContext } from "./botsContext.js";
import { requiresRemoteWorkspaceRuntime } from "./botsInboundRuntime.js";

export interface BotBindCodeRecord {
  botId: string;
  code: string;
  allowedWorkspaces: string[];
  expiresAt: number;
}

export type AuthorizedContext =
  | { ok: false; reply: BotOutboundMessage[] }
  | {
      ok: true;
      config: BotsConfig;
      bot: BotConfigEntry;
      user: BotConfigEntry;
      context: BotRuntimeState;
      locale: BotMessageLocale;
    };

export function createInboundHandlers(deps: {
  repo: BotsRepo;
  settingService: Pick<ISettingService, "get">;
  remoteWorkspaceService?: IBotRemoteWorkspaceService;
  bindCodes: Map<string, BotBindCodeRecord>;
  workspaceRefs: ReturnType<typeof createWorkspaceRefCache>;
  reconnectInFlight: Map<string, Promise<BotOutboundMessage[]>>;
  reconnectCooldown: Map<string, number>;
  reconnectDelivery?: Map<string, number>;
  sendTyping?(bot: BotConfigEntry, actor: BotActor): Promise<void>;
}): {
  readMessageLocale(): Promise<BotMessageLocale>;
  withAuthorizedContext(message: BotInboundMessage, command: string): Promise<AuthorizedContext>;
  handleBind(message: BotInboundMessage, code: string): Promise<BotOutboundMessage[]>;
  handleHelp(message: BotInboundMessage): Promise<BotOutboundMessage[]>;
  handleStatus(message: BotInboundMessage): Promise<BotOutboundMessage[]>;
  handleReconnect(message: BotInboundMessage): Promise<BotOutboundMessage[]>;
  handleUnknown(message: BotInboundMessage, name: string): Promise<BotOutboundMessage[]>;
  handleWeixinFirstActivation(
    message: BotInboundMessage,
    commandType: string,
  ): Promise<BotOutboundMessage[] | null>;
  handleModeLocked(message: BotInboundMessage): Promise<BotOutboundMessage[]>;
  handleReplyList(message: BotInboundMessage): Promise<BotOutboundMessage[]>;
  handleReplySet(message: BotInboundMessage, value: string): Promise<BotOutboundMessage[]>;
  replies(
    actor: BotActor,
    text: string,
    locale?: BotMessageLocale,
    selection?: BotSelection,
    extra?: Partial<BotProviderOutbound>,
  ): BotOutboundMessage[];
  setCreateStatusReply(
    fn: (
      actor: BotActor,
      context: BotRuntimeState,
      locale: BotMessageLocale,
    ) => Promise<BotOutboundMessage[]>,
  ): void;
} {
  async function readMessageLocale(): Promise<BotMessageLocale> {
    const settings = await deps.settingService.get().catch(() => null);
    return normalizeBotMessageLocale(settings?.locale);
  }

  function replies(
    actor: BotActor,
    text: string,
    locale?: BotMessageLocale,
    selection?: BotSelection,
    extra?: Partial<BotProviderOutbound>,
  ): BotOutboundMessage[] {
    return toOutboundMessages(actor, [
      createOutbound(actor, text, selection, locale ? { locale, ...extra } : (extra ?? {})),
    ]);
  }

  let createStatusReplyImpl: (
    actor: BotActor,
    context: BotRuntimeState,
    locale: BotMessageLocale,
  ) => Promise<BotOutboundMessage[]> = async (actor, _context, locale) =>
    replies(actor, copy(locale, "statusDraft"), locale);

  async function readContext(
    actor: BotActor,
    bot: BotConfigEntry,
  ): Promise<BotRuntimeState | null> {
    const state = await deps.repo.readState();
    const existing = state.bots[bot.id];
    const workspaces = await deps.workspaceRefs.list();
    if (existing) {
      const matched = resolveCanonicalContextWorkspace(existing, workspaces);
      if (!matched) {
        return existing;
      }
      const next = {
        ...existing,
        workspacePath: matched.workspacePath,
        workspaceIdentity: matched.workspaceIdentity,
        workspaceId:
          existing.workspaceId && existing.workspaceId !== matched.id
            ? existing.workspaceId
            : matched.id,
      };
      if (
        next.workspacePath === existing.workspacePath &&
        next.workspaceIdentity === existing.workspaceIdentity &&
        next.workspaceId === existing.workspaceId
      ) {
        return existing;
      }
      return writeContext(deps, next);
    }
    const allowed = firstAllowedWorkspace(workspaces, bot);
    if (!allowed) {
      return null;
    }
    return {
      botId: bot.id,
      workspacePath: allowed.workspacePath,
      workspaceIdentity: allowed.workspaceIdentity,
      workspaceId: allowed.id,
      mode: "draft",
      activeTaskId: null,
      draftOptions: await buildInitializedDraftOptions(allowed, (item) =>
        isRemoteWorkspaceConnected(deps, item),
      ),
      updatedAt: Date.now(),
    };
  }

  async function withAuthorizedContext(
    message: BotInboundMessage,
    command: string,
  ): Promise<AuthorizedContext> {
    const locale = await readMessageLocale();
    const config = await deps.repo.readConfig();
    const bot = findAuthorizedBot(config, message.actor);
    if (!bot || bot.id !== message.botId) {
      return { ok: false, reply: replies(message.actor, copy(locale, "botDisabled")) };
    }
    if (message.actor.chatType !== "private") {
      return { ok: false, reply: replies(message.actor, copy(locale, "privateChatOnly")) };
    }
    const user = findBoundUser(bot, message.actor);
    if (!user) {
      return { ok: false, reply: replies(message.actor, copy(locale, "userNotBound")) };
    }
    if (!isUserCommandAllowed(user, command)) {
      return { ok: false, reply: replies(message.actor, copy(locale, "commandNotAllowed")) };
    }
    const context = await readContext(message.actor, bot);
    if (!context) {
      return { ok: false, reply: replies(message.actor, copy(locale, "noWorkspaceAllowed")) };
    }
    const current = {
      id: context.workspaceId ?? `${context.workspaceIdentity?.trim() || context.workspacePath}`,
      label: context.workspacePath,
      workspacePath: context.workspacePath,
      workspaceIdentity: context.workspaceIdentity,
    };
    const workspaces = await deps.workspaceRefs.list(current);
    const allowed = normalizeConfiguredAllowedWorkspaces(bot.allowedWorkspaces, workspaces);
    const nextBot = { ...bot, allowedWorkspaces: allowed };
    const nextConfig = {
      ...config,
      bots: config.bots.map((item) => (item.id === bot.id ? nextBot : item)),
    };
    if (nextBot.allowedWorkspaces.join("\n") !== bot.allowedWorkspaces.join("\n")) {
      await deps.repo.writeConfig(nextConfig);
    }
    if (
      context.workspaceId &&
      !isWorkspaceAllowed(context.workspaceId, nextBot.allowedWorkspaces)
    ) {
      return { ok: false, reply: replies(message.actor, copy(locale, "workspaceOutOfScope")) };
    }
    if (
      context.workspaceIdentity &&
      requiresRemoteWorkspaceRuntime(command) &&
      !(await isRemoteWorkspaceConnected(deps, context))
    ) {
      return {
        ok: false,
        reply: replies(
          message.actor,
          copy(locale, "remoteDisconnected", { workspacePath: context.workspacePath }),
        ),
      };
    }
    if (deps.sendTyping) {
      if (isFeishuBotProvider(nextBot.provider)) {
        await deps.sendTyping(nextBot, message.actor);
      } else {
        void deps.sendTyping(nextBot, message.actor);
      }
    }
    return { ok: true, config: nextConfig, bot: nextBot, user: nextBot, context, locale };
  }

  // 发布包 keepNames 落在具名函数上。对象方法不会留下这些 inbound 命令名。
  async function handleHelp(message: BotInboundMessage): Promise<BotOutboundMessage[]> {
    const authorized = await withAuthorizedContext(message, "help");
    return authorized.ok
      ? replies(message.actor, buildHelpText(authorized.locale, authorized.bot))
      : authorized.reply;
  }

  async function handleStatus(message: BotInboundMessage): Promise<BotOutboundMessage[]> {
    const authorized = await withAuthorizedContext(message, "status");
    return authorized.ok
      ? createStatusReplyImpl(message.actor, authorized.context, authorized.locale)
      : authorized.reply;
  }

  async function handleReconnect(message: BotInboundMessage): Promise<BotOutboundMessage[]> {
    return handleBotReconnect({
      message,
      authorized: await withAuthorizedContext(message, "workspace"),
      remoteWorkspaceService: deps.remoteWorkspaceService,
      repo: deps.repo,
      createStatusReply: createStatusReplyImpl,
      replies,
      reconnectInFlight: deps.reconnectInFlight,
      reconnectCooldown: deps.reconnectCooldown,
      reconnectDelivery: deps.reconnectDelivery ?? new Map(),
    });
  }

  async function handleWeixinFirstActivation(
    message: BotInboundMessage,
    commandType: string,
  ): Promise<BotOutboundMessage[] | null> {
    if (message.actor.provider !== "weixin" || commandType !== "message") {
      return null;
    }
    const state = await deps.repo.readState();
    const existing = state.bots[message.botId];
    if (
      existing?.weixinActivatedAt ||
      existing?.draftOptions ||
      existing?.activeTaskId ||
      existing?.pendingPermissionOptions ||
      existing?.pendingElicitation
    ) {
      return null;
    }
    const authorized = await withAuthorizedContext(message, "help");
    if (!authorized.ok) {
      return authorized.reply;
    }
    if (authorized.context.weixinActivatedAt) {
      return null;
    }
    await writeContext(deps, { ...authorized.context, weixinActivatedAt: Date.now() });
    return replies(
      message.actor,
      [
        copy(authorized.locale, "weixinActivatedWelcome"),
        buildHelpText(authorized.locale, authorized.bot),
      ].join("\n\n"),
    );
  }

  return {
    readMessageLocale,
    withAuthorizedContext,
    replies,
    setCreateStatusReply(fn) {
      createStatusReplyImpl = fn;
    },
    async handleBind(message, code) {
      return bindBot({
        message,
        code,
        locale: await readMessageLocale(),
        repo: deps.repo,
        bindCodes: deps.bindCodes,
        replies,
      });
    },
    handleHelp,
    handleStatus,
    handleReconnect,
    async handleUnknown(message, name) {
      return replies(
        message.actor,
        copy(await readMessageLocale(), "unknownCommand", { command: name }),
      );
    },
    async handleModeLocked(message) {
      const authorized = await withAuthorizedContext(message, "mode");
      return authorized.ok
        ? replies(message.actor, copy(authorized.locale, "modeLocked"))
        : authorized.reply;
    },
    async handleReplyList(message) {
      const authorized = await withAuthorizedContext(message, "reply");
      if (!authorized.ok) {
        return authorized.reply;
      }
      const currentId = normalizeBotReplyGranularity(
        authorized.bot.provider,
        authorized.bot.replyMode,
      );
      const selection: BotSelection = {
        id: `reply-${Date.now()}`,
        title: copy(authorized.locale, "replySelectTitle", {
          mode: formatReplyGranularityLabel(
            authorized.locale,
            authorized.bot.provider,
            authorized.bot.replyMode,
          ),
        }),
        currentId,
        action: "reply.set",
        options: getReplyGranularityOptions(authorized.locale, authorized.bot.provider),
      };
      return replies(message.actor, selection.title, authorized.locale, selection);
    },
    async handleReplySet(message, value) {
      const authorized = await withAuthorizedContext(message, "reply");
      if (!authorized.ok) {
        return authorized.reply;
      }
      const nextMode = parseReplyGranularity(value, authorized.locale, authorized.bot.provider);
      if (!nextMode) {
        return replies(message.actor, copy(authorized.locale, "replyMissing"));
      }
      await deps.repo.writeConfig({
        ...authorized.config,
        bots: authorized.config.bots.map((item) =>
          item.id === authorized.bot.id ? { ...authorized.bot, replyMode: nextMode } : item,
        ),
      });
      return createStatusReplyImpl(message.actor, authorized.context, authorized.locale);
    },
    handleWeixinFirstActivation,
  };
}

export {
  buildHelpText,
  copy,
  createWorkspaceRefCache,
  formatStatusLine,
  formatStatusStateValue,
  getActorContextKey,
} from "./botsInboundText.js";

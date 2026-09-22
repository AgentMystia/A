import {
  type BotActor,
  type BotConfigEntry,
  type BotInboundMessage,
  type BotOutboundMessage,
  type BotRuntimeState,
  type BotsConfig,
  normalizeBotReplyGranularity,
} from "@zcode/shared";
import type { ISettingService } from "../setting/setting.js";
import { normalizeBotMessageLocale, type BotMessageLocale } from "./botsCopy.js";
import {
  buildHelpText,
  copy,
  createWorkspaceRefCache,
  formatStatusLine,
  formatStatusStateValue,
  getActorContextKey,
} from "./botsInboundText.js";
import {
  findAuthorizedBot,
  findBoundUser,
  findBot,
  firstAllowedWorkspace,
  isUserCommandAllowed,
  isWorkspaceAllowed,
  normalizeAllowedWorkspaces,
  normalizeBotCommandPolicy,
} from "./botsNormalize.js";
import { createOutbound, toOutboundMessages } from "./botsOutbound.js";
import { handleBotReconnect } from "./botsInboundReconnect.js";
import {
  formatReplyGranularityLabel,
  listReplyGranularityOptions,
  parseReplyGranularity,
} from "./botsReply.js";
import type { IBotRemoteWorkspaceService } from "./botsRemoteWorkspace.js";
import type { BotsRepo } from "./botsRepo.js";
import type { BotSelection } from "./botsTypes.js";

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
  replies(actor: BotActor, text: string, locale?: BotMessageLocale, selection?: BotSelection): BotOutboundMessage[];
  persistContext(context: BotRuntimeState): Promise<BotRuntimeState>;
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
  ): BotOutboundMessage[] {
    return toOutboundMessages(actor, [
      createOutbound(actor, text, selection, locale ? { locale } : {}),
    ]);
  }

  async function persistContext(context: BotRuntimeState): Promise<BotRuntimeState> {
    const state = await deps.repo.readState();
    const next = { ...context, updatedAt: Date.now() };
    state.bots[context.botId] = next;
    await deps.repo.writeState(state);
    return next;
  }

  async function readContext(actor: BotActor, bot: BotConfigEntry): Promise<BotRuntimeState | null> {
    const state = await deps.repo.readState();
    const existing = state.bots[bot.id];
    const workspaces = await deps.workspaceRefs.list();
    if (existing) {
      const matched =
        workspaces.find((workspace) => workspace.id === existing.workspaceId) ??
        workspaces.find(
          (workspace) =>
            workspace.workspacePath === existing.workspacePath &&
            workspace.workspaceIdentity === existing.workspaceIdentity,
        );
      if (!matched) {
        return existing;
      }
      const next = {
        ...existing,
        workspacePath: matched.workspacePath,
        workspaceIdentity: matched.workspaceIdentity,
        workspaceId: existing.workspaceId && existing.workspaceId !== matched.id ? existing.workspaceId : matched.id,
      };
      if (
        next.workspacePath === existing.workspacePath &&
        next.workspaceIdentity === existing.workspaceIdentity &&
        next.workspaceId === existing.workspaceId
      ) {
        return existing;
      }
      return persistContext(next);
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
      updatedAt: Date.now(),
    };
  }

  async function isRemoteConnected(context: BotRuntimeState): Promise<boolean> {
    if (!context.workspaceIdentity) {
      return true;
    }
    if (!deps.remoteWorkspaceService) {
      return false;
    }
    return deps.remoteWorkspaceService.isConnected({
      workspacePath: context.workspacePath,
      workspaceIdentity: context.workspaceIdentity,
    });
  }

  async function buildStatusText(context: BotRuntimeState, locale: BotMessageLocale): Promise<string> {
    const workspace = (await deps.workspaceRefs.list()).find((item) => item.id === context.workspaceId);
    if (!(await isRemoteConnected(context))) {
      return [
        formatStatusLine(locale, "statusWorkspace", workspace?.label ?? context.workspacePath),
        formatStatusLine(locale, "statusModel", "-"),
        "------",
        formatStatusLine(locale, "statusTask", context.activeTaskId ?? copy(locale, "statusDraft")),
        formatStatusLine(locale, "statusState", formatStatusStateValue(locale, "remote disconnected")),
        copy(locale, "remoteDisconnectedStatus", { workspacePath: context.workspacePath }),
      ].join("\n");
    }
    return [
      formatStatusLine(locale, "statusWorkspace", workspace?.label ?? context.workspacePath),
      formatStatusLine(locale, "statusModel", "-"),
      "------",
      formatStatusLine(locale, "statusTask", context.activeTaskId ?? copy(locale, "statusDraft")),
      formatStatusLine(locale, "statusState", formatStatusStateValue(locale, context.mode === "draft" ? "draft" : "draft")),
    ].join("\n");
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
    if (context.workspaceId && !isWorkspaceAllowed(context.workspaceId, user.allowedWorkspaces)) {
      return { ok: false, reply: replies(message.actor, copy(locale, "workspaceOutOfScope")) };
    }
    return { ok: true, config, bot, user, context, locale };
  }

  return {
    readMessageLocale,
    withAuthorizedContext,
    replies,
    persistContext,
    async handleBind(message, code) {
      const locale = await readMessageLocale();
      if (message.actor.chatType !== "private") {
        return replies(message.actor, copy(locale, "bindPrivateOnly"));
      }
      const record = deps.bindCodes.get(code.trim().toUpperCase());
      if (!record || record.expiresAt <= Date.now() || record.botId !== message.botId) {
        return replies(message.actor, copy(locale, "bindCodeInvalid"));
      }
      const config = await deps.repo.readConfig();
      const bot = findBot(config, record.botId);
      if (!bot) {
        return replies(message.actor, copy(locale, "bindBotMissing"));
      }
      const next: BotConfigEntry = {
        ...bot,
        providerUserId: message.actor.providerUserId,
        displayName: message.actor.displayName,
        allowedWorkspaces: normalizeAllowedWorkspaces(record.allowedWorkspaces),
        allowedCommands: normalizeBotCommandPolicy(bot.allowedCommands),
        replyMode: normalizeBotReplyGranularity(bot.provider, bot.replyMode),
      };
      await deps.repo.writeConfig({
        ...config,
        bots: config.bots.map((item) => (item.id === next.id ? next : item)),
      });
      deps.bindCodes.delete(record.code);
      return replies(message.actor, [copy(locale, "bindSuccess"), buildHelpText(locale, next)].join("\n\n"));
    },
    async handleHelp(message) {
      const authorized = await withAuthorizedContext(message, "help");
      return authorized.ok
        ? replies(message.actor, buildHelpText(authorized.locale, authorized.bot))
        : authorized.reply;
    },
    async handleStatus(message) {
      const authorized = await withAuthorizedContext(message, "status");
      if (!authorized.ok) {
        return authorized.reply;
      }
      return replies(
        message.actor,
        await buildStatusText(authorized.context, authorized.locale),
        authorized.locale,
      );
    },
    async handleReconnect(message) {
      return handleBotReconnect({
        message,
        authorized: await withAuthorizedContext(message, "workspace"),
        remoteWorkspaceService: deps.remoteWorkspaceService,
        isRemoteConnected,
        replies,
        reconnectInFlight: deps.reconnectInFlight,
        reconnectCooldown: deps.reconnectCooldown,
      });
    },
    async handleUnknown(message, name) {
      return replies(message.actor, copy(await readMessageLocale(), "unknownCommand", { command: name }));
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
      const currentId = normalizeBotReplyGranularity(authorized.bot.provider, authorized.bot.replyMode);
      const selection: BotSelection = {
        id: `reply-${Date.now()}`,
        title: copy(authorized.locale, "replySelectTitle", {
          mode: formatReplyGranularityLabel(authorized.locale, authorized.bot.provider, authorized.bot.replyMode),
        }),
        currentId,
        action: "reply.set",
        options: listReplyGranularityOptions(authorized.locale, authorized.bot.provider),
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
      return replies(
        message.actor,
        await buildStatusText(authorized.context, authorized.locale),
        authorized.locale,
      );
    },
    async handleWeixinFirstActivation(message, commandType) {
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
      await persistContext({ ...authorized.context, weixinActivatedAt: Date.now() });
      return replies(
        message.actor,
        [copy(authorized.locale, "weixinActivatedWelcome"), buildHelpText(authorized.locale, authorized.bot)].join(
          "\n\n",
        ),
      );
    },
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

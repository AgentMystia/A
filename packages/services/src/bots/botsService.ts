import {
  type BotAutomationRunWatch,
  type BotInboundMessage,
  type BotOutboundMessage,
  type BotProviderCallbackResult,
  type BotProviderId,
  type BotRuntimeStatus,
  type BotsConfig,
  type BotWorkspaceRef,
} from "@zcode/shared";
import type { ICredentialService } from "../credential/credential.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { ISettingService } from "../setting/setting.js";
import type { IBroadcastService } from "../broadcast/broadcast.js";
import type { IModelSelectionService } from "../model-provider/providerFacadeServices.js";
import type { IZCodeTaskService } from "../session/zcodeTaskService.js";
import { createProviderCallbackProcessor } from "./botsCallback.js";
import { createFeishuBotProvider } from "./botsFeishu.js";
import { beginFeishuAppRegistration, pollFeishuAppRegistration } from "./botsFeishuRegistration.js";
import { createFeishuChannelRuntime } from "./botsFeishuRuntime.js";
import { createInboundHandlers, createWorkspaceRefCache, type BotBindCodeRecord } from "./botsInbound.js";
import { dispatchInboundMessage } from "./botsInboundDispatch.js";
import { createStatusReply } from "./botsInboundDraft.js";
import type { BotContextTaskEntry, BotInboundTaskRuntime } from "./botsInboundRuntime.js";
import {
  resolveModelSelectionServiceForContext,
  resolveZCodeTaskServiceForContext,
} from "./botsInboundRuntime.js";
import { createBotsMutationApi } from "./botsMutations.js";
import { normalizeConfigBots } from "./botsNormalize.js";
import { createInboundQueue, sendOutbound } from "./botsOutbound.js";
import { createBotPollingState } from "./botsPollingState.js";
import type { IBotRemoteWorkspaceService } from "./botsRemoteWorkspace.js";
import { BotsRepo } from "./botsRepo.js";
import { createTelegramBotProvider } from "./botsTelegram.js";
import { createTelegramChannelRuntime } from "./botsTelegramRuntime.js";
import type { IBotsService } from "./bots.js";
import type { BotProvider, BotRuntimeStatusSink, BotSelection } from "./botsTypes.js";
import { createWebhookBotProvider } from "./botsWebhook.js";
import { createWeixinBotProvider } from "./botsWeixin.js";
import { beginWeixinRegistration, pollWeixinRegistration } from "./botsWeixinRegistration.js";
import { createWeixinChannelRuntime } from "./botsWeixinRuntime.js";
import { createTypingController, watchAutomationRun } from "./botsTaskStream.js";

export interface CreateBotsServiceOptions {
  runStartupBackgroundTasks?: boolean;
  repo?: BotsRepo;
  credentialService: ICredentialService;
  settingService: Pick<ISettingService, "get">;
  remoteWorkspaceService?: IBotRemoteWorkspaceService;
  zcodeTaskService?: IZCodeTaskService;
  modelSelectionService?: IModelSelectionService;
  broadcastService?: Pick<IBroadcastService, "send">;
}

/** 发布包 host `createBotsService`。 */
export function createBotsService(options: CreateBotsServiceOptions): IBotsService {
  const runBackgroundTasks = options.runStartupBackgroundTasks !== false;
  const repo = options.repo ?? new BotsRepo();
  const logger = createServiceLogger("bots");
  const bindCodes = new Map<string, BotBindCodeRecord>();
  const runtimeStatus = new Map<string, BotRuntimeStatus>();
  const workspaceRefs = createWorkspaceRefCache(options.settingService);
  const reconnectInFlight = new Map<string, Promise<BotOutboundMessage[]>>();
  const reconnectCooldown = new Map<string, number>();
  const reconnectDelivery = new Map<string, number>();
  const runningTasks = new Set<string>();
  const streamSubs = new Map<string, { dispose(): void }>();
  const pendingSelections = new Map<string, BotSelection>();
  const taskSelectionEntries = new Map<string, Map<string, BotContextTaskEntry>>();
  const workspaceSelectionEntries = new Map<string, Map<string, { workspace: BotWorkspaceRef }>>();
  const automationWarnAt = new Map<string, number>();
  const inboundQueue = createInboundQueue();
  const polling = createBotPollingState(repo, () => workspaceRefs.list());
  let migrated: Promise<void> | null = null;
  let disposing: Promise<void> | null = null;
  const loadCredential = (ref: string) => options.credentialService.load(ref);
  const setRuntimeStatus: BotRuntimeStatusSink["setRuntimeStatus"] = (status) => {
    const previous = runtimeStatus.get(status.botId);
    runtimeStatus.set(status.botId, {
      botId: status.botId,
      provider: status.provider,
      status: status.status ?? previous?.status ?? "idle",
      message: status.message ?? previous?.message,
      messageId: status.messageId ?? previous?.messageId,
      offset: status.offset ?? previous?.offset,
      deliveryError: status.deliveryError ?? previous?.deliveryError,
      lastUpdateAt: Date.now(),
    });
  };
  const statusSink: BotRuntimeStatusSink = {
    getRuntimeStatus: (botId) => runtimeStatus.get(botId),
    setRuntimeStatus,
  };
  const providers: Record<BotProviderId, BotProvider | null> = {
    telegram: createTelegramBotProvider({ loadCredential }),
    webhook: createWebhookBotProvider({ loadCredential }),
    feishu: createFeishuBotProvider({
      loadCredential,
      onDeliveryResult: (bot, error) =>
        setRuntimeStatus({
          botId: bot.id,
          provider: bot.provider,
          status: runtimeStatus.get(bot.id)?.status ?? (bot.enabled ? "idle" : "disabled"),
          deliveryError: error,
        }),
    }),
    lark: createFeishuBotProvider({
      loadCredential,
      onDeliveryResult: (bot, error) =>
        setRuntimeStatus({
          botId: bot.id,
          provider: bot.provider,
          status: runtimeStatus.get(bot.id)?.status ?? (bot.enabled ? "idle" : "disabled"),
          deliveryError: error,
        }),
    }),
    weixin: createWeixinBotProvider({ loadCredential }),
    discord: null,
    wecom: null,
  };
  const typing = createTypingController(providers);

  async function ensureBotStorageMigrated(): Promise<void> {
    migrated ??= Promise.all([repo.readConfig(), repo.readState()])
      .then(() => undefined)
      .catch((error) => {
        migrated = null;
        throw error;
      });
    await migrated;
  }

  const inbound = createInboundHandlers({
    repo,
    settingService: options.settingService,
    remoteWorkspaceService: options.remoteWorkspaceService,
    bindCodes,
    workspaceRefs,
    reconnectInFlight,
    reconnectCooldown,
    reconnectDelivery,
    sendTyping: async (bot, actor) => {
      const provider = providers[bot.provider];
      const userId = actor.chatId ?? actor.providerUserId;
      if (!provider?.sendTyping || !userId) {
        return;
      }
      await provider
        .sendTyping(bot, {
          providerUserId: userId,
          providerMessageId: actor.providerMessageId,
          providerContextToken: actor.providerContextToken,
        })
        .catch(() => undefined);
    },
  });
  const runtime: BotInboundTaskRuntime = {
    repo,
    remoteWorkspaceService: options.remoteWorkspaceService,
    broadcastService: options.broadcastService,
    zcodeTaskService: options.zcodeTaskService,
    modelSelectionService: options.modelSelectionService,
    logger,
    runningTasks,
    streamSubs,
    pendingSelections,
    taskSelectionEntries,
    workspaceSelectionEntries,
    automationWarnAt,
    persistContext: (context) => inbound.persistContext(context),
    replies: (actor, text, locale, selection, extra) => inbound.replies(actor, text, locale, selection, extra),
    withAuthorizedContext: (message, command) => inbound.withAuthorizedContext(message, command),
    readMessageLocale: () => inbound.readMessageLocale(),
    listWorkspaceRefs: (current) => inbound.listWorkspaceRefs(current),
    isRemoteConnected: (context) => inbound.isRemoteConnected(context),
    async saveBot(bot) {
      return mutations.saveBot({ bot });
    },
    async sendOutbound(bot, outbound) {
      await sendOutbound(providers[bot.provider], bot, outbound);
    },
    async sendAckTyping(bot, actor) {
      const provider = providers[bot.provider];
      const userId = actor.chatId ?? actor.providerUserId;
      if (!provider?.sendTyping || !userId) {
        return;
      }
      await provider
        .sendTyping(bot, {
          providerUserId: userId,
          providerMessageId: actor.providerMessageId,
          providerContextToken: actor.providerContextToken,
        })
        .catch(() => undefined);
    },
    startTyping: (bot, actor, taskId) => typing.startTyping(bot, actor, taskId),
    stopTyping: (taskId) => typing.stopTyping(taskId),
    resolveZCodeTaskServiceForContext: (context) => resolveZCodeTaskServiceForContext(runtime, context),
    resolveModelSelectionServiceForContext: (context) =>
      resolveModelSelectionServiceForContext(runtime, context),
  };
  inbound.setCreateStatusReply((actor, context, locale) => createStatusReply(runtime, actor, context, locale));
  let service!: IBotsService;
  const callback = createProviderCallbackProcessor({
    logger,
    credentialService: options.credentialService,
    providers,
    readConfig: () => repo.readConfig(),
    readLocale: () => inbound.readMessageLocale(),
    handleInboundMessage: (message) => service.handleInboundMessage(message),
  });
  const telegramRuntime = createTelegramChannelRuntime({
    runBackgroundTasks,
    credentialService: options.credentialService,
    telegramProvider: providers.telegram!,
    logger,
    statusSink,
    ensureBotStorageMigrated,
    readConfig: () => repo.readConfig(),
    readTelegramOffset: polling.readTelegramOffset,
    writeTelegramOffset: polling.writeTelegramOffset,
    processProviderCallback: (provider, payload) => callback.processProviderCallback(provider, payload),
  });
  const weixinRuntime = createWeixinChannelRuntime({
    runBackgroundTasks,
    credentialService: options.credentialService,
    logger,
    statusSink,
    ensureBotStorageMigrated,
    readConfig: () => repo.readConfig(),
    readWeixinGetUpdatesBuf: polling.readWeixinGetUpdatesBuf,
    writeWeixinGetUpdatesBuf: polling.writeWeixinGetUpdatesBuf,
    processProviderCallback: (provider, payload) => callback.processProviderCallback(provider, payload),
  });
  const feishuRuntime = createFeishuChannelRuntime({
    runBackgroundTasks,
    credentialService: options.credentialService,
    logger,
    statusSink,
    ensureBotStorageMigrated,
    readConfig: () => repo.readConfig(),
    summarizeCallbackPayload: (payload) => JSON.stringify(payload).slice(0, 500),
    processProviderCallback: (provider, payload) => callback.processProviderCallback(provider, payload),
  });
  const refreshRuntimes = (config?: BotsConfig) => {
    workspaceRefs.clear();
    telegramRuntime.scheduleRefresh(config);
    weixinRuntime.scheduleRefresh(config);
    feishuRuntime.scheduleRefresh(config);
  };
  const mutations = createBotsMutationApi({
    repo,
    credentialService: options.credentialService,
    logger,
    providers,
    bindCodes,
    refreshRuntimes,
    stopTelegram: (bot) => telegramRuntime.syncCommands(bot),
    stopFeishu: (botId) => feishuRuntime.stopWebSocket(botId),
    stopWeixin: (botId) => weixinRuntime.stopPolling(botId),
  });

  service = {
    async syncAppRuntimePreferences(preferences) {
      await options.remoteWorkspaceService?.syncAppRuntimePreferences(
        preferences as Parameters<NonNullable<IBotRemoteWorkspaceService["syncAppRuntimePreferences"]>>[0],
      );
    },
    async getStatus() {
      const config = await repo.readConfig();
      const state = await repo.readState();
      return {
        botsCount: config.bots.length,
        enabledBotsCount: config.bots.filter((bot) => bot.enabled).length,
        contextsCount: Object.keys(state.bots).length,
        botRuntime: config.bots.map(
          (bot) =>
            runtimeStatus.get(bot.id) ?? {
              botId: bot.id,
              provider: bot.provider,
              status: bot.enabled ? "idle" : "disabled",
              message: bot.enabled ? "Bot is configured." : "Bot is disabled.",
              offset: state.bots[bot.id]?.telegramOffset,
            },
        ),
      };
    },
    getConfig: () => repo.readConfig(),
    listWorkspaceRefs: () => workspaceRefs.list(),
    async getUserConfigOptions() {
      return [];
    },
    beginFeishuRegistration: (request) => beginFeishuAppRegistration(request?.domain),
    pollFeishuRegistration: (request) => pollFeishuAppRegistration(request),
    beginWeixinRegistration,
    pollWeixinRegistration,
    async saveConfig(config) {
      const next = await repo.writeConfig(normalizeConfigBots(config));
      refreshRuntimes(next);
      return next;
    },
    async listBots() {
      return (await repo.readConfig()).bots;
    },
    saveBot: (request) => mutations.saveBot(request),
    removeBotSecret: (botId) => mutations.removeBotSecret(botId),
    deleteBot: (botId) => mutations.deleteBot(botId),
    testBot: (botId) => mutations.testBot(botId),
    createBindCode: (request) => mutations.createBindCode(request),
    async getBotStates() {
      return Object.values((await repo.readState()).bots);
    },
    async resetBotState(botId) {
      const state = await repo.readState();
      delete state.bots[botId];
      await repo.writeState(state);
    },
    async watchAutomationRun(watch: BotAutomationRunWatch) {
      await watchAutomationRun(runtime, watch);
    },
    handleInboundMessage(message: BotInboundMessage) {
      return inboundQueue.enqueue(message.actor, () => dispatchInboundMessage(runtime, inbound, message));
    },
    async handleProviderCallback(provider, payload) {
      return (await callback.processProviderCallback(provider, payload)).replies;
    },
    async handleProviderCallbackResponse(provider, payload): Promise<BotProviderCallbackResult> {
      return callback.processProviderCallback(provider, payload);
    },
    disposeAll() {
      service.disposeAllAndWait().catch((error) => {
        logger.warn(
          undefined,
          `dispose Bot runtimes failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    },
    disposeAllAndWait() {
      if (disposing) {
        return disposing;
      }
      options.remoteWorkspaceService?.dispose();
      typing.dispose();
      for (const sub of streamSubs.values()) {
        sub.dispose();
      }
      streamSubs.clear();
      runningTasks.clear();
      pendingSelections.clear();
      taskSelectionEntries.clear();
      workspaceSelectionEntries.clear();
      reconnectInFlight.clear();
      reconnectCooldown.clear();
      reconnectDelivery.clear();
      disposing = Promise.allSettled([
        telegramRuntime.dispose(),
        weixinRuntime.dispose(),
        feishuRuntime.dispose(),
      ]).then(() => undefined);
      return disposing;
    },
  };
  if (runBackgroundTasks) {
    telegramRuntime.refresh();
    weixinRuntime.refresh();
    feishuRuntime.refresh();
    ensureBotStorageMigrated().catch((error) => {
      logger.error(
        undefined,
        `Bot storage initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
  return service;
}

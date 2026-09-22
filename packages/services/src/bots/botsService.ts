import {
  type BotAutomationRunWatch,
  type BotInboundMessage,
  type BotOutboundMessage,
  type BotProviderCallbackResult,
  type BotProviderId,
  type BotRuntimeStatus,
  type BotsConfig,
} from "@zcode/shared";
import type { ICredentialService } from "../credential/credential.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { ISettingService } from "../setting/setting.js";
import { createProviderCallbackProcessor } from "./botsCallback.js";
import { createFeishuBotProvider } from "./botsFeishu.js";
import { beginFeishuAppRegistration, pollFeishuAppRegistration } from "./botsFeishuRegistration.js";
import { createFeishuChannelRuntime } from "./botsFeishuRuntime.js";
import { createInboundHandlers, createWorkspaceRefCache, type BotBindCodeRecord } from "./botsInbound.js";
import { createBotsMutationApi } from "./botsMutations.js";
import { normalizeConfigBots } from "./botsNormalize.js";
import { createInboundQueue } from "./botsOutbound.js";
import { parseBotCommand } from "./botsParseCommand.js";
import { createBotPollingState } from "./botsPollingState.js";
import type { IBotRemoteWorkspaceService } from "./botsRemoteWorkspace.js";
import { BotsRepo } from "./botsRepo.js";
import { createTelegramBotProvider } from "./botsTelegram.js";
import { createTelegramChannelRuntime } from "./botsTelegramRuntime.js";
import type { IBotsService } from "./bots.js";
import type { BotProvider, BotRuntimeStatusSink } from "./botsTypes.js";
import { createWebhookBotProvider } from "./botsWebhook.js";
import { createWeixinBotProvider } from "./botsWeixin.js";
import { beginWeixinRegistration, pollWeixinRegistration } from "./botsWeixinRegistration.js";
import { createWeixinChannelRuntime } from "./botsWeixinRuntime.js";

export interface CreateBotsServiceOptions {
  runStartupBackgroundTasks?: boolean;
  repo?: BotsRepo;
  credentialService: ICredentialService;
  settingService: Pick<ISettingService, "get">;
  remoteWorkspaceService?: IBotRemoteWorkspaceService;
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
  });
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
      const config = await repo.readConfig();
      const bot = config.bots.find((item) => item.id === watch.target.botId);
      if (!bot || !bot.enabled || bot.provider !== watch.target.provider) {
        logger.warn(
          undefined,
          `automation Bot delivery skipped provider=${watch.target.provider} bot=${watch.target.botId} reason=${
            !bot ? "bot_missing" : !bot.enabled ? "bot_disabled" : "provider_mismatch"
          }`,
        );
        return;
      }
      const state = await repo.readState();
      state.bots[bot.id] = {
        botId: bot.id,
        workspacePath: watch.workspacePath,
        workspaceIdentity: watch.workspaceIdentity,
        mode: "task",
        activeTaskId: watch.taskId,
        updatedAt: Date.now(),
      };
      await repo.writeState(state);
    },
    handleInboundMessage(message: BotInboundMessage) {
      return inboundQueue.enqueue(message.actor, async () => {
        const parsed = parseBotCommand(message.text);
        const activated = await inbound.handleWeixinFirstActivation(
          message,
          parsed.type === "message" ? "message" : parsed.type,
        );
        if (activated) {
          return activated;
        }
        switch (parsed.type) {
          case "bind":
            return inbound.handleBind(message, parsed.code);
          case "help":
            return inbound.handleHelp(message);
          case "status":
            return inbound.handleStatus(message);
          case "reconnect":
            return inbound.handleReconnect(message);
          case "mode.list":
          case "mode.set":
            return inbound.handleModeLocked(message);
          case "reply.list":
            return inbound.handleReplyList(message);
          case "reply.set":
            return inbound.handleReplySet(message, parsed.value);
          case "unknown":
            return inbound.handleUnknown(message, parsed.name);
          default:
            return inbound.handleUnknown(message, parsed.type);
        }
      });
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

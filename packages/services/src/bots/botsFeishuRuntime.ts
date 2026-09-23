import {
  isFeishuBotProvider,
  type BotConfigEntry,
  type BotsConfig,
  type BotProviderCallbackResult,
  type BotProviderOutbound,
} from "@zcode/shared";
import type { ServiceLogger } from "../logger/serviceLogger.js";
import { BOT_RUNTIME_ERROR_RETRY_MS } from "./botsConstants.js";
import { waitFor, waitForAbort } from "./botsHttp.js";
import { acquireFeishuWebSocketLock } from "./botsLocks.js";
import {
  assertBotCallbackSucceeded,
  createBotConnectionFingerprint,
  createLatestRuntimeRefreshQueue,
  TELEGRAM_ELSEWHERE_WAIT_MS,
} from "./botsQueue.js";
import type { BotRuntimeStatusSink } from "./botsTypes.js";
import { startFeishuBotWebSocket } from "./botsFeishuWebSocket.js";

export function createFeishuChannelRuntime(options: {
  runBackgroundTasks: boolean;
  credentialService: { load: (ref: string) => Promise<string | null> };
  logger: ServiceLogger;
  statusSink: BotRuntimeStatusSink;
  ensureBotStorageMigrated: () => Promise<void>;
  readConfig: () => Promise<BotsConfig>;
  summarizeCallbackPayload: (payload: unknown) => string;
  processProviderCallback: (
    provider: BotConfigEntry["provider"],
    payload: unknown,
  ) => Promise<BotProviderCallbackResult>;
}): {
  dispose: () => Promise<void>;
  refresh: (config?: BotsConfig) => Promise<void>;
  scheduleRefresh: (config?: BotsConfig) => void;
  stopWebSocket: (botId: string) => Promise<void>;
} {
  const sessions = new Map<
    string,
    { controller: AbortController; fingerprint: string; done: Promise<void> }
  >();
  const queue = createLatestRuntimeRefreshQueue();

  async function runBot(bot: BotConfigEntry, signal: AbortSignal): Promise<void> {
    let socket: { close: () => void; terminated?: Promise<void> } | null = null;
    while (!signal.aborted) {
      let lock;
      try {
        lock = await acquireFeishuWebSocketLock(bot);
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: bot.provider,
          status: "error",
          message: `Feishu WebSocket lock failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        await waitFor(BOT_RUNTIME_ERROR_RETRY_MS, signal);
        continue;
      }
      if (!lock) {
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: bot.provider,
          status: "idle",
          message: "Feishu WebSocket is handled by another ZCode window.",
        });
        await waitFor(TELEGRAM_ELSEWHERE_WAIT_MS, signal);
        continue;
      }
      let failed = false;
      try {
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: bot.provider,
          status: "connected",
          messageId: "bots.runtime.feishuWebSocketConnecting",
          message: "Feishu WebSocket is connecting.",
        });
        socket = await startFeishuBotWebSocket({
          bot,
          signal,
          onConnectionStateChange: (state) => {
            options.statusSink.setRuntimeStatus({
              botId: bot.id,
              provider: bot.provider,
              status: "connected",
              message:
                state === "reconnecting"
                  ? "Feishu WebSocket is reconnecting."
                  : "Feishu WebSocket is running.",
              messageId:
                state === "reconnecting"
                  ? "bots.runtime.feishuWebSocketConnecting"
                  : "bots.runtime.feishuWebSocketRunning",
            });
          },
          deps: { loadCredential: (ref) => options.credentialService.load(ref) },
          onPayload: async (payload) => {
            if (signal.aborted) {
              return undefined;
            }
            options.logger.debug(
              undefined,
              `feishu websocket payload bot=${bot.id} ${options.summarizeCallbackPayload(payload)}`,
            );
            const result = await options.processProviderCallback(bot.provider, payload);
            assertBotCallbackSucceeded(bot.provider === "lark" ? "Lark" : "Feishu", result);
            return result.replies[0] as BotProviderOutbound | undefined;
          },
        });
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: bot.provider,
          status: "connected",
          message: "Feishu WebSocket is running.",
          messageId: "bots.runtime.feishuWebSocketRunning",
        });
        await Promise.race([
          waitForAbort(signal),
          socket.terminated ?? new Promise(() => undefined),
        ]);
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: bot.provider,
          status: "error",
          message: `Feishu WebSocket failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        failed = true;
      } finally {
        if (socket) {
          try {
            socket.close();
          } catch (error) {
            options.logger.debug(
              undefined,
              `close Feishu WebSocket failed bot=${bot.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          socket = null;
        }
        await lock.release().catch((error) => {
          options.logger.warn(
            undefined,
            `release Feishu WebSocket lock failed bot=${bot.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
      if (failed) {
        await waitFor(BOT_RUNTIME_ERROR_RETRY_MS, signal);
      }
    }
  }

  async function stopWebSocket(botId: string): Promise<void> {
    const session = sessions.get(botId);
    session?.controller.abort();
    if (session) {
      await session.done;
      if (sessions.get(botId) === session) {
        sessions.delete(botId);
      }
    }
    const status = options.statusSink.getRuntimeStatus(botId);
    if (status) {
      options.statusSink.setRuntimeStatus({
        ...status,
        status: "idle",
        messageId: "bots.runtime.feishuWebSocketStopped",
        message: "Feishu WebSocket is stopped.",
      });
    }
  }

  function startWebSocket(bot: BotConfigEntry, fingerprint: string): void {
    if (sessions.has(bot.id)) {
      return;
    }
    const controller = new AbortController();
    options.statusSink.setRuntimeStatus({
      botId: bot.id,
      provider: bot.provider,
      status: "connected",
      messageId: "bots.runtime.feishuWebSocketStarting",
      message: "Feishu WebSocket is starting.",
    });
    const session = { controller, fingerprint, done: Promise.resolve() };
    session.done = runBot(bot, controller.signal).finally(() => {
      if (sessions.get(bot.id) === session) {
        sessions.delete(bot.id);
        if (options.statusSink.getRuntimeStatus(bot.id)?.status === "connected") {
          options.statusSink.setRuntimeStatus({
            botId: bot.id,
            provider: bot.provider,
            status: "idle",
            messageId: "bots.runtime.feishuWebSocketStopped",
            message: "Feishu WebSocket is stopped.",
          });
        }
      }
    });
    sessions.set(bot.id, session);
  }

  // 发布包 keepNames 落在具名函数上。对象方法缩写不会留下这些名字。
  async function getConnectionFingerprint(bot: BotConfigEntry): Promise<string> {
    const credential = bot.credentialRef
      ? await options.credentialService.load(bot.credentialRef)
      : null;
    return createBotConnectionFingerprint([
      bot.provider,
      bot.feishuAppId ?? "",
      bot.credentialRef ?? "",
      credential ?? "",
    ]);
  }

  async function reconcile(
    config: BotsConfig | undefined,
    isCurrent: () => boolean,
  ): Promise<void> {
    await options.ensureBotStorageMigrated();
    const current = config ?? (await options.readConfig());
    if (!isCurrent()) {
      return;
    }
    const enabled = new Set(
      current.bots
        .filter(
          (bot) =>
            isFeishuBotProvider(bot.provider) &&
            bot.enabled &&
            bot.credentialRef &&
            bot.feishuAppId,
        )
        .map((bot) => bot.id),
    );
    for (const botId of sessions.keys()) {
      if (!enabled.has(botId) && (await stopWebSocket(botId), !isCurrent())) {
        return;
      }
    }
    for (const bot of current.bots) {
      if (
        isFeishuBotProvider(bot.provider) &&
        bot.enabled &&
        bot.credentialRef &&
        bot.feishuAppId
      ) {
        const fingerprint = await getConnectionFingerprint(bot);
        if (!isCurrent()) {
          return;
        }
        const existing = sessions.get(bot.id);
        if (
          existing &&
          existing.fingerprint !== fingerprint &&
          (await stopWebSocket(bot.id), !isCurrent())
        ) {
          return;
        }
        startWebSocket(bot, fingerprint);
      } else if (isFeishuBotProvider(bot.provider) && !bot.enabled) {
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: bot.provider,
          status: "disabled",
          messageId: "bots.runtime.botDisabled",
          message: "Bot is disabled.",
        });
      }
    }
  }

  function refresh(config?: BotsConfig): Promise<void> {
    return queue.enqueue((isCurrent) => reconcile(config, isCurrent));
  }

  function scheduleRefresh(config?: BotsConfig): void {
    if (options.runBackgroundTasks !== false) {
      refresh(config).catch((error) => {
        options.logger.warn(
          undefined,
          `refresh Feishu WebSocket failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  }

  async function dispose(): Promise<void> {
    queue.invalidate();
    const running = [...sessions.values()];
    for (const session of running) {
      session.controller.abort();
    }
    await Promise.allSettled(running.map((session) => session.done));
    for (const [botId, session] of sessions) {
      if (running.includes(session)) {
        sessions.delete(botId);
      }
    }
  }

  return { dispose, refresh, scheduleRefresh, stopWebSocket };
}

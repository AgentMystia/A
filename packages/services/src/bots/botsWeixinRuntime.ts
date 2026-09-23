import type { BotConfigEntry, BotsConfig, BotProviderCallbackResult } from "@zcode/shared";
import type { ServiceLogger } from "../logger/serviceLogger.js";
import { BOT_RUNTIME_ERROR_RETRY_MS } from "./botsConstants.js";
import { waitFor } from "./botsHttp.js";
import { acquireWeixinPollingLock } from "./botsLocks.js";
import {
  assertBotCallbackSucceeded,
  createBotConnectionFingerprint,
  createLatestRuntimeRefreshQueue,
  TELEGRAM_ELSEWHERE_WAIT_MS,
} from "./botsQueue.js";
import type { BotRuntimeStatusSink } from "./botsTypes.js";
import { getWeixinUpdates } from "./botsWeixin.js";

export function createWeixinChannelRuntime(options: {
  runBackgroundTasks: boolean;
  credentialService: { load: (ref: string) => Promise<string | null> };
  logger: ServiceLogger;
  statusSink: BotRuntimeStatusSink;
  ensureBotStorageMigrated: () => Promise<void>;
  readConfig: () => Promise<BotsConfig>;
  readWeixinGetUpdatesBuf: (botId: string) => Promise<string | undefined>;
  writeWeixinGetUpdatesBuf: (botId: string, buf: string) => Promise<void>;
  processProviderCallback: (
    provider: "weixin",
    payload: unknown,
  ) => Promise<BotProviderCallbackResult>;
}): {
  dispose: () => Promise<void>;
  refresh: (config?: BotsConfig) => Promise<void>;
  scheduleRefresh: (config?: BotsConfig) => void;
  stopPolling: (botId: string) => Promise<void>;
} {
  const sessions = new Map<
    string,
    { controller: AbortController; fingerprint: string; done: Promise<void> }
  >();
  const queue = createLatestRuntimeRefreshQueue();

  async function pollBot(bot: BotConfigEntry, signal: AbortSignal): Promise<void> {
    const token = bot.credentialRef
      ? await options.credentialService.load(bot.credentialRef)
      : null;
    if (!token?.trim()) {
      options.statusSink.setRuntimeStatus({
        botId: bot.id,
        provider: "weixin",
        status: "error",
        message: "Weixin bot token is missing.",
      });
      return;
    }
    while (!signal.aborted) {
      let lock;
      try {
        lock = await acquireWeixinPollingLock(token, bot.id);
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: "weixin",
          status: "error",
          message: `Weixin polling lock failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        await waitFor(BOT_RUNTIME_ERROR_RETRY_MS, signal);
        continue;
      }
      if (!lock) {
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: "weixin",
          status: "idle",
          message: "Weixin long polling is handled by another ZCode window.",
        });
        await waitFor(TELEGRAM_ELSEWHERE_WAIT_MS, signal);
        continue;
      }
      try {
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: "weixin",
          status: "polling",
          message: "Weixin long polling is running.",
          messageId: "bots.runtime.weixinLongPollingRunning",
        });
        while (!signal.aborted) {
          const buf = await options.readWeixinGetUpdatesBuf(bot.id);
          const updates = await getWeixinUpdates({
            bot,
            deps: { loadCredential: (ref) => options.credentialService.load(ref) },
            buf,
            signal,
          });
          if (signal.aborted) {
            return;
          }
          for (const message of updates.messages) {
            const result = await options.processProviderCallback("weixin", {
              botId: bot.id,
              messages: [
                {
                  id: message.actor.providerMessageId,
                  text: message.text,
                  from: message.actor.providerUserId,
                  chatId: message.actor.chatId,
                  displayName: message.actor.displayName,
                  context_token: message.actor.providerContextToken,
                  attachments: message.attachments,
                },
              ],
              ...(updates.buf ? { buf: updates.buf } : {}),
            });
            assertBotCallbackSucceeded("Weixin", result);
          }
          if (updates.buf) {
            await options.writeWeixinGetUpdatesBuf(bot.id, updates.buf);
          }
          options.statusSink.setRuntimeStatus({
            botId: bot.id,
            provider: "weixin",
            status: "polling",
            message: "Weixin long polling is running.",
            messageId: "bots.runtime.weixinLongPollingRunning",
          });
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: "weixin",
          status: "error",
          message: `Weixin polling failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        await waitFor(BOT_RUNTIME_ERROR_RETRY_MS, signal);
      } finally {
        await lock.release().catch((error) => {
          options.logger.debug(
            undefined,
            `release Weixin polling lock failed bot=${bot.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    }
  }

  async function stopPolling(botId: string): Promise<void> {
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
        messageId: "bots.runtime.weixinLongPollingStopped",
        message: "Weixin long polling is stopped.",
      });
    }
  }

  function startPolling(bot: BotConfigEntry, fingerprint: string): void {
    if (sessions.has(bot.id)) {
      return;
    }
    const controller = new AbortController();
    options.statusSink.setRuntimeStatus({
      botId: bot.id,
      provider: "weixin",
      status: "polling",
      messageId: "bots.runtime.weixinLongPollingStarting",
      message: "Weixin long polling is starting.",
    });
    const session = { controller, fingerprint, done: Promise.resolve() };
    session.done = pollBot(bot, controller.signal).finally(() => {
      if (sessions.get(bot.id) === session) {
        sessions.delete(bot.id);
        if (options.statusSink.getRuntimeStatus(bot.id)?.status === "polling") {
          options.statusSink.setRuntimeStatus({
            botId: bot.id,
            provider: "weixin",
            status: "idle",
            messageId: "bots.runtime.weixinLongPollingStopped",
            message: "Weixin long polling is stopped.",
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
        .filter((bot) => bot.provider === "weixin" && bot.enabled && bot.credentialRef)
        .map((bot) => bot.id),
    );
    for (const botId of sessions.keys()) {
      if (!enabled.has(botId) && (await stopPolling(botId), !isCurrent())) {
        return;
      }
    }
    for (const bot of current.bots) {
      if (bot.provider === "weixin" && bot.enabled && bot.credentialRef) {
        const fingerprint = await getConnectionFingerprint(bot);
        if (!isCurrent()) {
          return;
        }
        const existing = sessions.get(bot.id);
        if (
          existing &&
          existing.fingerprint !== fingerprint &&
          (await stopPolling(bot.id), !isCurrent())
        ) {
          return;
        }
        startPolling(bot, fingerprint);
      } else if (bot.provider === "weixin" && !bot.enabled) {
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: "weixin",
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
          `refresh Weixin polling failed: ${error instanceof Error ? error.message : String(error)}`,
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

  return { dispose, refresh, scheduleRefresh, stopPolling };
}

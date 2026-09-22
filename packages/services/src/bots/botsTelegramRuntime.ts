import type { BotConfigEntry, BotsConfig, BotProviderCallbackResult } from "@zcode/shared";
import type { ServiceLogger } from "../logger/serviceLogger.js";
import {
  BOT_CONFLICT_RETRY_MS,
  BOT_RUNTIME_ERROR_RETRY_MS,
  TELEGRAM_ELSEWHERE_WAIT_MS,
  TELEGRAM_GET_UPDATES_TIMEOUT_MS,
  TELEGRAM_LONG_POLL_SECONDS,
} from "./botsConstants.js";
import { fetchBotProvider, fetchBotProviderJson, waitFor } from "./botsHttp.js";
import { isRecord } from "./botsJson.js";
import { acquireTelegramPollingLock } from "./botsLocks.js";
import { assertBotCallbackSucceeded, createBotConnectionFingerprint, createLatestRuntimeRefreshQueue } from "./botsQueue.js";
import type { BotProvider, BotRuntimeStatusSink } from "./botsTypes.js";

export function createTelegramChannelRuntime(options: {
  runBackgroundTasks: boolean;
  credentialService: { load: (ref: string) => Promise<string | null> };
  telegramProvider: BotProvider;
  logger: ServiceLogger;
  statusSink: BotRuntimeStatusSink;
  ensureBotStorageMigrated: () => Promise<void>;
  readConfig: () => Promise<BotsConfig>;
  readTelegramOffset: (botId: string) => Promise<number | undefined>;
  writeTelegramOffset: (botId: string, offset: number) => Promise<void>;
  processProviderCallback: (provider: "telegram", payload: unknown) => Promise<BotProviderCallbackResult>;
}): {
  dispose: () => Promise<void>;
  refresh: (config?: BotsConfig) => Promise<void>;
  scheduleRefresh: (config?: BotsConfig) => void;
  stopPolling: (botId: string) => Promise<void>;
  syncCommands: (bot: BotConfigEntry) => Promise<void>;
} {
  const sessions = new Map<string, { controller: AbortController; fingerprint: string; done: Promise<void> }>();
  const queue = createLatestRuntimeRefreshQueue();

  async function syncCommands(bot: BotConfigEntry): Promise<void> {
    if (options.runBackgroundTasks !== false) {
      await options.telegramProvider.syncCommands?.(bot).catch((error) => {
        options.logger.warn(undefined, `sync Telegram commands failed bot=${bot.id}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  async function pollBot(bot: BotConfigEntry, signal: AbortSignal): Promise<void> {
    const token = bot.credentialRef ? await options.credentialService.load(bot.credentialRef) : null;
    if (!token?.trim()) {
      options.statusSink.setRuntimeStatus({
        botId: bot.id,
        provider: "telegram",
        status: "error",
        messageId: "bots.runtime.telegramTokenMissing",
        message: "Telegram bot token is missing.",
      });
      return;
    }
    while (!signal.aborted) {
      let lock;
      try {
        lock = await acquireTelegramPollingLock(token, bot.id);
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: "telegram",
          status: "error",
          message: `Telegram polling lock failed: ${error instanceof Error ? error.message : String(error)}`,
          offset: await options.readTelegramOffset(bot.id),
        });
        await waitFor(BOT_RUNTIME_ERROR_RETRY_MS, signal);
        continue;
      }
      if (!lock) {
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: "telegram",
          status: "idle",
          messageId: "bots.runtime.telegramLongPollingHandledElsewhere",
          message: "Telegram long polling is handled by another ZCode window.",
          offset: await options.readTelegramOffset(bot.id),
        });
        await waitFor(TELEGRAM_ELSEWHERE_WAIT_MS, signal);
        continue;
      }
      try {
        try {
          await fetchBotProvider(`https://api.telegram.org/bot${token}/deleteWebhook`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ drop_pending_updates: false }),
            signal,
          });
        } catch {
          if (signal.aborted) {
            return;
          }
        }
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: "telegram",
          status: "polling",
          message: "Telegram long polling is running.",
          messageId: "bots.runtime.telegramLongPollingRunning",
          offset: await options.readTelegramOffset(bot.id),
        });
        while (!signal.aborted) {
          const offset = await options.readTelegramOffset(bot.id);
          const result = await fetchBotProviderJson<{ ok?: boolean; result?: unknown[]; description?: string }>(
            `https://api.telegram.org/bot${token}/getUpdates`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                timeout: TELEGRAM_LONG_POLL_SECONDS,
                ...(offset !== undefined ? { offset } : {}),
                allowed_updates: ["message", "callback_query"],
              }),
              signal,
            },
            TELEGRAM_GET_UPDATES_TIMEOUT_MS,
          );
          if (!result.ok) {
            options.statusSink.setRuntimeStatus({
              botId: bot.id,
              provider: "telegram",
              status: "error",
              message:
                result.status === 409
                  ? "Telegram token is already used by another polling client."
                  : `Telegram getUpdates failed: HTTP ${result.status}`,
              offset,
            });
            await waitFor(result.status === 409 ? BOT_CONFLICT_RETRY_MS : BOT_RUNTIME_ERROR_RETRY_MS, signal);
            continue;
          }
          if (result.payload?.ok !== true || !Array.isArray(result.payload.result)) {
            options.statusSink.setRuntimeStatus({
              botId: bot.id,
              provider: "telegram",
              status: "error",
              message: result.payload?.description ?? "Telegram getUpdates returned an invalid response.",
              offset,
            });
            await waitFor(BOT_RUNTIME_ERROR_RETRY_MS, signal);
            continue;
          }
          if (signal.aborted) {
            return;
          }
          for (const update of result.payload.result) {
            if (signal.aborted) {
              return;
            }
            const updateId = isRecord(update) && typeof update.update_id === "number" ? update.update_id : null;
            const callback = await options.processProviderCallback("telegram", { botId: bot.id, update });
            assertBotCallbackSucceeded("Telegram", callback);
            if (updateId !== null) {
              await options.writeTelegramOffset(bot.id, updateId + 1);
            }
          }
          options.statusSink.setRuntimeStatus({
            botId: bot.id,
            provider: "telegram",
            status: "polling",
            message: "Telegram long polling is running.",
            messageId: "bots.runtime.telegramLongPollingRunning",
            offset: await options.readTelegramOffset(bot.id),
          });
        }
      } catch {
        if (signal.aborted) {
          return;
        }
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: "telegram",
          status: "error",
          messageId: "bots.runtime.telegramPollingFailedRetrying",
          message: "Telegram polling failed; retrying.",
          offset: await options.readTelegramOffset(bot.id),
        });
        await waitFor(BOT_RUNTIME_ERROR_RETRY_MS, signal);
      } finally {
        await lock.release().catch((error) => {
          options.logger.debug(undefined, `release Telegram polling lock failed bot=${bot.id}: ${error instanceof Error ? error.message : String(error)}`);
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
        messageId: "bots.runtime.telegramLongPollingStopped",
        message: "Telegram long polling is stopped.",
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
      provider: "telegram",
      status: "polling",
      messageId: "bots.runtime.telegramLongPollingStarting",
      message: "Telegram long polling is starting.",
    });
    const session = { controller, fingerprint, done: Promise.resolve() };
    session.done = pollBot(bot, controller.signal)
      .catch((error) => {
        options.logger.warn(undefined, `Telegram polling stopped unexpectedly bot=${bot.id}: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        if (sessions.get(bot.id) === session) {
          sessions.delete(bot.id);
          const status = options.statusSink.getRuntimeStatus(bot.id);
          if (status?.status === "polling") {
            options.statusSink.setRuntimeStatus({
              botId: bot.id,
              provider: "telegram",
              status: "idle",
              messageId: "bots.runtime.telegramLongPollingStopped",
              message: "Telegram long polling is stopped.",
              offset: status.offset,
            });
          }
        }
      });
    sessions.set(bot.id, session);
  }

  async function reconcile(config: BotsConfig | undefined, isCurrent: () => boolean): Promise<void> {
    await options.ensureBotStorageMigrated();
    const current = config ?? (await options.readConfig());
    if (!isCurrent()) {
      return;
    }
    const enabled = new Set(current.bots.filter((bot) => bot.provider === "telegram" && bot.enabled && bot.credentialRef).map((bot) => bot.id));
    for (const botId of sessions.keys()) {
      if (!enabled.has(botId) && (await stopPolling(botId), !isCurrent())) {
        return;
      }
    }
    for (const bot of current.bots) {
      if (bot.provider === "telegram" && bot.enabled && bot.credentialRef) {
        await syncCommands(bot);
        if (!isCurrent()) {
          return;
        }
        const credential = await options.credentialService.load(bot.credentialRef);
        const fingerprint = createBotConnectionFingerprint([bot.provider, bot.credentialRef ?? "", credential ?? ""]);
        const existing = sessions.get(bot.id);
        if (existing && existing.fingerprint !== fingerprint && (await stopPolling(bot.id), !isCurrent())) {
          return;
        }
        startPolling(bot, fingerprint);
      } else if (bot.provider === "telegram" && !bot.enabled) {
        await syncCommands(bot);
        options.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: "telegram",
          status: "disabled",
          messageId: "bots.runtime.botDisabled",
          message: "Bot is disabled.",
        });
      }
    }
  }

  const refresh = (config?: BotsConfig) => queue.enqueue((isCurrent) => reconcile(config, isCurrent));
  return {
    async dispose() {
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
    },
    refresh,
    scheduleRefresh(config) {
      if (options.runBackgroundTasks !== false) {
        refresh(config).catch((error) => {
          options.logger.warn(undefined, `refresh Telegram polling failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    },
    stopPolling,
    syncCommands,
  };
}

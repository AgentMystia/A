import type { BotConfigEntry, BotInboundMessage, BotOutboundMessage, BotProviderOutbound } from "@zcode/shared";
import {
  FEISHU_APP_ID_PATTERN,
  FEISHU_WS_OPEN_STATE,
  FEISHU_WS_READY_POLL_MS,
  FEISHU_WS_STARTUP_TIMEOUT_MS,
} from "./botsConstants.js";
import { isRecord } from "./botsJson.js";
import type { BotCredentialLoader } from "./botsTypes.js";
import {
  buildFeishuElicitationCardPayload,
  buildFeishuInteractiveCardPayload,
} from "./botsFeishuCards.js";
import { getFeishuDomainProvider } from "./botsFeishuUrls.js";
import { readFeishuAppSecret } from "./botsFeishuToken.js";

export function createFeishuWebSocketEventHandlers(input: {
  bot: BotConfigEntry;
  onPayload: (payload: unknown) => Promise<BotProviderOutbound | undefined>;
}): Record<string, (payload: unknown) => Promise<unknown>> {
  const { bot, onPayload } = input;
  return {
    "im.message.receive_v1": async (payload) => {
      await onPayload({ botId: bot.id, zcodeProvider: bot.provider, ...(isRecord(payload) ? payload : { payload }) });
    },
    "im.message.reaction.created_v1": async () => undefined,
    "card.action.trigger": async (payload) => {
      const reply = await onPayload({
        botId: bot.id,
        zcodeProvider: bot.provider,
        zcodeFeishuSynchronousCardAction: true,
        ...(isRecord(payload) ? payload : { payload }),
      });
      if (reply) {
        return {
          card: {
            type: "raw",
            data: reply.elicitation ? buildFeishuElicitationCardPayload(reply) : buildFeishuInteractiveCardPayload(reply),
          },
        };
      }
      return undefined;
    },
  };
}

export async function startFeishuBotWebSocket(input: {
  bot: BotConfigEntry;
  deps: BotCredentialLoader;
  onPayload: (payload: unknown) => Promise<BotProviderOutbound | undefined>;
  signal?: AbortSignal;
  onConnectionStateChange?: (state: "connected" | "reconnecting") => void;
}): Promise<{ close: () => void; terminated: Promise<void> }> {
  const appId = input.bot.feishuAppId;
  if (!appId || !FEISHU_APP_ID_PATTERN.test(appId)) {
    throw new Error("Invalid Feishu App ID.");
  }
  const appSecret = await readFeishuAppSecret(input.bot, input.deps);
  if (!appSecret) {
    throw new Error("Feishu App ID and App Secret are required.");
  }
  if (input.signal?.aborted) {
    throw new Error("Feishu WebSocket startup aborted.");
  }
  const sdk = (await import("@larksuiteoapi/node-sdk")) as {
    EventDispatcher: new (options: Record<string, unknown>) => {
      register: (handlers: Record<string, unknown>) => void;
    };
    WSClient: new (options: Record<string, unknown>) => {
      start: (options: { eventDispatcher: unknown }) => Promise<void>;
      close: () => void;
      isConnecting?: boolean;
      wsConfig?: { getWSInstance?: () => { readyState?: number } | undefined };
    };
    Domain: { Lark: unknown; Feishu: unknown };
    LoggerLevel: { info: unknown };
  };
  if (input.signal?.aborted) {
    throw new Error("Feishu WebSocket startup aborted.");
  }
  const dispatcher = new sdk.EventDispatcher({});
  dispatcher.register(createFeishuWebSocketEventHandlers({ bot: input.bot, onPayload: input.onPayload }));
  return new Promise((resolve, reject) => {
    let started = false;
    let finished = false;
    let closed = false;
    let reconnecting = false;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let settleTerminated: ((error?: Error) => void) | undefined;
    const terminated = new Promise<void>((ok, fail) => {
      settleTerminated = (error) => {
        if (error) {
          fail(error);
        } else {
          ok();
        }
      };
    });
    const finishLifecycle = (error?: Error) => {
      if (finished) {
        return;
      }
      finished = true;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      settleTerminated?.(error);
    };
    const fail = (error: Error) => {
      if (started) {
        return;
      }
      started = true;
      if (startupTimer) {
        clearTimeout(startupTimer);
      }
      input.signal?.removeEventListener("abort", handleAbort);
      closeClient();
      reject(error);
    };
    function handleAbort() {
      fail(new Error("Feishu WebSocket startup aborted."));
    }
    function closeClient() {
      if (closed) {
        return;
      }
      closed = true;
      finishLifecycle();
      client.close();
    }
    const client = new sdk.WSClient({
      appId,
      appSecret,
      domain: getFeishuDomainProvider(input.bot) === "lark" ? sdk.Domain.Lark : sdk.Domain.Feishu,
      loggerLevel: sdk.LoggerLevel.info,
    });
    pollTimer = setInterval(() => {
      const ready = client.wsConfig?.getWSInstance?.()?.readyState === FEISHU_WS_OPEN_STATE;
      if (!ready) {
        if (!started || closed) {
          return;
        }
        if (!reconnecting) {
          reconnecting = true;
          input.onConnectionStateChange?.("reconnecting");
        }
        if (client.isConnecting === false) {
          const exhausted = new Error("Feishu WebSocket reconnect exhausted.");
          finishLifecycle(exhausted);
          closeClient();
        }
        return;
      }
      if (started) {
        if (reconnecting) {
          reconnecting = false;
          input.onConnectionStateChange?.("connected");
        }
        return;
      }
      started = true;
      if (startupTimer) {
        clearTimeout(startupTimer);
      }
      input.signal?.removeEventListener("abort", handleAbort);
      resolve({ close: closeClient, terminated });
    }, FEISHU_WS_READY_POLL_MS);
    startupTimer = setTimeout(() => {
      fail(new Error(`Feishu WebSocket startup timed out after ${FEISHU_WS_STARTUP_TIMEOUT_MS}ms.`));
    }, FEISHU_WS_STARTUP_TIMEOUT_MS);
    input.signal?.addEventListener("abort", handleAbort, { once: true });
    if (input.signal?.aborted) {
      handleAbort();
      return;
    }
    client.start({ eventDispatcher: dispatcher }).catch((error: unknown) => {
      if (!started) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      finishLifecycle(error instanceof Error ? error : new Error(String(error)));
      closeClient();
    });
  });
}

export type { BotInboundMessage, BotOutboundMessage };

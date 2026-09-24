import {
  isFeishuBotProvider,
  type BotActor,
  type BotConfigEntry,
  type BotInboundMessage,
  type BotOutboundMessage,
  type BotProviderId,
} from "@zcode/shared";
import type { ServiceLogger } from "../logger/serviceLogger.js";
import { BOT_CALLBACK_ACK_TIMEOUT_MS } from "./botsConstants.js";
import { formatBotMessage, type BotMessageLocale } from "./botsCopy.js";
import { getActorContextKey } from "./botsInboundText.js";
import { isRecord } from "./botsJson.js";
import { createOutbound, sendOutbound } from "./botsOutbound.js";
import {
  finalizeTransientInteractionCard,
  upsertTransientInteractionCard,
  type TransientInteractionCardEntry,
} from "./botsTransientCards.js";
import type { BotProvider } from "./botsTypes.js";

const APPROVE_OR_DENY_TEXT = /^\/(?:approve|deny)(?:\s|$)/u;

const elicitationStatus = (() => {
  return (value: unknown): string | undefined =>
    isRecord(value) && typeof value.status === "string" ? value.status : undefined;
})();

const isAckHandled = (() => {
  return (value: unknown): boolean => isRecord(value) && value.handled === true;
})();

const toProviderOutbound = (() => {
  return (actor: BotActor, reply: BotOutboundMessage) =>
    createOutbound(actor, reply.text, reply.selection, {
      elicitation: reply.elicitation,
      locale: reply.locale,
    });
})();

/** 发布包 host callback 在 inbound 成功后的 acknowledge、临时卡片与 stopInboundTyping。 */
export const deliverProviderCallbackReplies = (() => {
  return async (
    input: {
      providerId: BotProviderId;
      provider: BotProvider;
      bot: BotConfigEntry;
      payload: unknown;
      message: BotInboundMessage;
      locale: BotMessageLocale;
      replies: BotOutboundMessage[];
      logger: Pick<ServiceLogger, "warn">;
      providers: Record<string, BotProvider | null>;
      transientCards: Map<string, TransientInteractionCardEntry>;
    },
    stopInbound: (bot: BotConfigEntry, actor: BotActor) => Promise<void>,
  ): Promise<void> => {
    const actorKey = getActorContextKey(input.message.actor);
    const card = input.transientCards.get(actorKey);
    const first = input.replies[0];
    const synchronous =
      isFeishuBotProvider(input.providerId) &&
      isRecord(input.payload) &&
      input.payload.zcodeFeishuSynchronousCardAction === true &&
      !!first;
    const toast = first?.text ?? formatBotMessage(input.locale, "received");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(
        new Error(
          `Bot provider callback acknowledgement timed out after ${BOT_CALLBACK_ACK_TIMEOUT_MS}ms.`,
        ),
      );
    }, BOT_CALLBACK_ACK_TIMEOUT_MS);
    let acknowledged: unknown;
    try {
      acknowledged = await Promise.race([
        synchronous || (card && !first?.elicitation)
          ? Promise.resolve(undefined)
          : input.provider.acknowledgeCallback?.(
              input.bot,
              input.payload,
              toast,
              first ? toProviderOutbound(input.message.actor, first) : undefined,
              controller.signal,
            ),
        new Promise((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
            once: true,
          });
        }),
      ]);
    } catch (error) {
      input.logger.warn(
        undefined,
        `provider callback acknowledge failed provider=${input.providerId} bot=${input.bot.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      clearTimeout(timer);
    }
    const handled = synchronous || isAckHandled(acknowledged);
    if (!synchronous && handled && card && first?.elicitation) {
      await input.providers[card.bot.provider]
        ?.updateTransientInteractionCard?.(
          card.bot,
          card.handle,
          toProviderOutbound(input.message.actor, first),
        )
        .catch((error) => {
          input.logger.warn(
            undefined,
            `refresh transient interaction card failed provider=${input.providerId} bot=${input.bot.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    }
    if (handled && card && elicitationStatus(first?.elicitation) !== "pending") {
      input.transientCards.delete(actorKey);
    }
    for (const reply of handled ? [] : input.replies) {
      const outbound = toProviderOutbound(input.message.actor, reply);
      if (card) {
        if (reply.selection || elicitationStatus(reply.elicitation) === "pending") {
          await upsertTransientInteractionCard(
            input.providers,
            input.transientCards,
            input.bot,
            input.message.actor,
            card.taskId,
            outbound,
          );
          continue;
        }
        if (reply.elicitation || APPROVE_OR_DENY_TEXT.test(input.message.text)) {
          await finalizeTransientInteractionCard(
            input.providers,
            input.transientCards,
            input.logger,
            input.message.actor,
            outbound,
          );
          continue;
        }
      }
      await sendOutbound(input.provider, input.bot, outbound);
    }
    await stopInbound(input.bot, input.message.actor);
  };
})();

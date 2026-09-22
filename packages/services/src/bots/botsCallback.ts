import {
  isFeishuBotProvider,
  type BotInboundMessage,
  type BotOutboundMessage,
  type BotProviderCallbackResult,
  type BotProviderId,
  type BotsConfig,
} from "@zcode/shared";
import { formatBotMessage, normalizeBotMessageLocale, type BotMessageLocale } from "./botsCopy.js";
import { createInboundDeliveryDedupe } from "./botsDedupe.js";
import { findBot } from "./botsNormalize.js";
import { isRecord } from "./botsJson.js";
import { createOutbound, sendOutbound, summarizeCallbackPayload, toOutboundMessages } from "./botsOutbound.js";
import type { BotProvider } from "./botsTypes.js";
import type { ServiceLogger } from "../logger/serviceLogger.js";

function readWebhookSecret(payload: unknown): string | undefined {
  return isRecord(payload) && typeof payload.webhookSecret === "string" ? payload.webhookSecret : undefined;
}

function readFeishuCallbackToken(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  if (typeof payload.token === "string") {
    return payload.token;
  }
  const header = isRecord(payload.header) ? payload.header : null;
  return typeof header?.token === "string" ? header.token : undefined;
}

export function createProviderCallbackProcessor(deps: {
  logger: ServiceLogger;
  credentialService: { load(key: string): Promise<string | null> };
  providers: Record<BotProviderId, BotProvider | null>;
  readConfig(): Promise<BotsConfig>;
  readLocale(): Promise<BotMessageLocale>;
  handleInboundMessage(message: BotInboundMessage): Promise<BotOutboundMessage[]>;
}): {
  processProviderCallback(
    provider: BotProviderId,
    payload: unknown,
  ): Promise<BotProviderCallbackResult>;
} {
  const dedupe = createInboundDeliveryDedupe();
  return {
    async processProviderCallback(provider, payload) {
      const impl = deps.providers[provider];
      if (!impl) {
        return { ok: false, replies: [], status: 400 };
      }
      const locale = await deps.readLocale();
      const config = await deps.readConfig();
      const parsed = impl.parseCallback(
        isFeishuBotProvider(provider) && isRecord(payload)
          ? { zcodeProvider: provider, ...payload }
          : payload,
      );
      if (isFeishuBotProvider(provider)) {
        deps.logger.debug(
          undefined,
          `provider callback parsed provider=${provider} count=${parsed.length} ${summarizeCallbackPayload(payload)}`,
        );
      }
      const replies: BotOutboundMessage[] = [];
      let failed = false;
      const webhookSecret = readWebhookSecret(payload);
      for (const inbound of parsed) {
        const bot = findBot(config, inbound.botId);
        if (bot?.provider === "webhook" && bot.webhookSecretRef) {
          const expected = await deps.credentialService.load(bot.webhookSecretRef);
          if (expected && expected !== webhookSecret) {
            replies.push(
              ...toOutboundMessages(inbound.actor, [
                createOutbound(inbound.actor, formatBotMessage(locale, "webhookSecretInvalid")),
              ]),
            );
            continue;
          }
        }
        if (bot && isFeishuBotProvider(bot.provider) && bot.webhookSecretRef) {
          const expected = await deps.credentialService.load(bot.webhookSecretRef);
          if (expected && expected !== readFeishuCallbackToken(payload)) {
            replies.push(
              ...toOutboundMessages(inbound.actor, [
                createOutbound(inbound.actor, formatBotMessage(locale, "webhookSecretInvalid")),
              ]),
            );
            continue;
          }
        }
        let message = inbound;
        if (bot && !inbound.actor.displayName && impl.resolveActorDisplayName) {
          try {
            const displayName = await impl.resolveActorDisplayName(bot, inbound.actor);
            if (displayName?.trim()) {
              message = { ...inbound, actor: { ...inbound.actor, displayName: displayName.trim() } };
            }
          } catch (error) {
            deps.logger.debug(
              undefined,
              `resolve actor displayName failed provider=${provider} bot=${inbound.botId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        if (!dedupe.mark(message)) {
          deps.logger.info(
            undefined,
            `provider callback duplicated provider=${provider} bot=${message.botId} user=${message.actor.providerUserId} messageId=${message.actor.providerMessageId ?? ""}`,
          );
          continue;
        }
        deps.logger.info(
          undefined,
          `provider callback provider=${provider} bot=${message.botId} user=${message.actor.providerUserId} displayName=${message.actor.displayName ?? ""} text=${message.text}`,
        );
        let outbound: BotOutboundMessage[] = [];
        try {
          outbound = await deps.handleInboundMessage(message);
        } catch (error) {
          failed = true;
          dedupe.release(message);
          const detail = error instanceof Error ? error.message : String(error);
          deps.logger.warn(
            undefined,
            `provider callback failed provider=${provider} bot=${message.botId}: ${detail}`,
          );
          outbound = toOutboundMessages(message.actor, [
            createOutbound(message.actor, formatBotMessage(locale, "callbackFailed", { message: detail })),
          ]);
        }
        replies.push(...outbound);
        if (bot) {
          try {
            const first = outbound[0];
            const toast = first?.text ?? formatBotMessage(locale, "received");
            await impl.acknowledgeCallback?.(
              bot,
              payload,
              toast,
              first
                ? createOutbound(message.actor, first.text, first.selection, {
                    elicitation: first.elicitation,
                    locale: first.locale,
                  })
                : undefined,
            );
            for (const reply of outbound) {
              await sendOutbound(
                impl,
                bot,
                createOutbound(message.actor, reply.text, reply.selection, {
                  elicitation: reply.elicitation,
                  locale: reply.locale,
                }),
              );
            }
          } catch (error) {
            dedupe.release(message);
            throw error;
          }
        }
      }
      return { ok: !failed, replies, ...(failed ? { status: 503 } : {}) };
    },
  };
}

export function readBotsLocale(value: unknown): BotMessageLocale {
  return normalizeBotMessageLocale(typeof value === "string" ? value : undefined);
}

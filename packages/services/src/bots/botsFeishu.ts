import type { BotConfigEntry } from "@zcode/shared";
import { fetchBotProviderJson } from "./botsHttp.js";
import { isRecord } from "./botsJson.js";
import type { BotCredentialLoader, BotProvider } from "./botsTypes.js";
import {
  buildFeishuElicitationCardPayload,
  buildFeishuInteractiveCardPayload,
  buildFeishuStreamingCardPayload,
  splitFeishuStreamingCardStates,
  splitFeishuText,
} from "./botsFeishuCards.js";
import {
  addFeishuTypingReaction,
  deleteFeishuInteractiveMessage,
  deleteFeishuTypingReaction,
  downloadFeishuAttachment,
  readFeishuAppDisplayName,
  sendFeishuInteractiveCard,
  updateFeishuInteractiveMessage,
} from "./botsFeishuHttp.js";
import {
  readFeishuCardAction,
  readFeishuCardOriginalText,
  readFeishuCardUpdateOpenIds,
  readFeishuCardUpdateToken,
  readFeishuTextMessage,
} from "./botsFeishuParse.js";
import { readTenantAccessToken } from "./botsFeishuToken.js";
import { getFeishuBaseUrl } from "./botsFeishuUrls.js";

export interface FeishuBotProviderDeps extends BotCredentialLoader {
  onDeliveryResult?: (bot: BotConfigEntry, error?: string) => void;
}

export function createFeishuBotProvider(deps: FeishuBotProviderDeps): BotProvider {
  async function trackDelivery<T>(
    bot: BotConfigEntry,
    signal: AbortSignal | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await run();
      if (!signal?.aborted) {
        deps.onDeliveryResult?.(bot, undefined);
      }
      return result;
    } catch (error) {
      if (!signal?.aborted) {
        deps.onDeliveryResult?.(bot, error instanceof Error ? error.message : String(error));
      }
      throw error;
    }
  }

  const sendCard = (
    bot: BotConfigEntry,
    token: string,
    receiveId: string,
    card: unknown,
    signal?: AbortSignal,
  ) =>
    trackDelivery(bot, signal, () =>
      sendFeishuInteractiveCard(bot, token, receiveId, card, signal),
    );
  const updateCard = (
    bot: BotConfigEntry,
    token: string,
    handle: { providerMessageId: string },
    card: unknown,
    signal?: AbortSignal,
  ) =>
    trackDelivery(bot, signal, () =>
      updateFeishuInteractiveMessage(bot, token, handle, card, signal),
    );

  return {
    async test(bot) {
      if (!bot.enabled) {
        return { ok: false, message: "Feishu bot is disabled." };
      }
      if (!bot.feishuAppId || !bot.credentialRef) {
        return { ok: false, message: "Feishu App ID and App Secret are required." };
      }
      return (await readTenantAccessToken(bot, deps))
        ? { ok: true, message: "Feishu app credentials are valid." }
        : { ok: false, message: "Feishu app credentials are missing." };
    },
    resolveName(bot) {
      return readFeishuAppDisplayName(bot, deps);
    },
    async send(bot, outbound) {
      const token = await readTenantAccessToken(bot, deps);
      if (!token) {
        return;
      }
      if (outbound.selection) {
        await sendCard(
          bot,
          token,
          outbound.providerUserId,
          outbound.elicitation
            ? buildFeishuElicitationCardPayload(outbound)
            : buildFeishuInteractiveCardPayload(outbound),
        );
        return;
      }
      for (const chunk of splitFeishuText(outbound.text)) {
        await sendCard(
          bot,
          token,
          outbound.providerUserId,
          buildFeishuInteractiveCardPayload({ ...outbound, text: chunk, selection: undefined }),
        );
      }
    },
    async createStreamingReplyCard(bot, state, signal) {
      const token = await readTenantAccessToken(bot, deps, signal);
      if (!token) {
        return null;
      }
      const messageId = await sendCard(
        bot,
        token,
        state.providerUserId,
        buildFeishuStreamingCardPayload(state),
        signal,
      );
      return messageId ? { providerMessageId: messageId } : null;
    },
    async updateStreamingReplyCard(bot, handle, state, signal) {
      const token = await readTenantAccessToken(bot, deps, signal);
      if (token) {
        await updateCard(bot, token, handle, buildFeishuStreamingCardPayload(state), signal);
      }
    },
    splitStreamingReplyCardStates(state) {
      return splitFeishuStreamingCardStates(state).map((item) => ({
        ...item,
        providerUserId: state.providerUserId,
      }));
    },
    async createTransientInteractionCard(bot, outbound) {
      const token = await readTenantAccessToken(bot, deps);
      if (!token) {
        return null;
      }
      const messageId = await sendCard(
        bot,
        token,
        outbound.providerUserId,
        outbound.elicitation
          ? buildFeishuElicitationCardPayload(outbound)
          : buildFeishuInteractiveCardPayload(outbound),
      );
      return messageId ? { providerMessageId: messageId } : null;
    },
    async updateTransientInteractionCard(bot, handle, outbound) {
      const token = await readTenantAccessToken(bot, deps);
      if (token) {
        await updateCard(
          bot,
          token,
          handle,
          outbound.elicitation
            ? buildFeishuElicitationCardPayload(outbound)
            : buildFeishuInteractiveCardPayload(outbound),
        );
      }
    },
    async deleteTransientInteractionCard(bot, handle) {
      const token = await readTenantAccessToken(bot, deps);
      if (token) {
        await deleteFeishuInteractiveMessage(bot, token, handle);
      }
    },
    async sendTyping(bot, actor) {
      if (actor.providerMessageId) {
        await addFeishuTypingReaction(bot, deps, actor.providerMessageId);
      }
    },
    async startTyping(bot, actor) {
      if (actor.providerMessageId) {
        await addFeishuTypingReaction(bot, deps, actor.providerMessageId);
      }
    },
    async stopTyping(bot, actor) {
      if (actor.providerMessageId) {
        await deleteFeishuTypingReaction(bot, deps, actor.providerMessageId);
      }
    },
    async acknowledgeCallback(bot, payload, toast, outbound, signal) {
      const token = await readTenantAccessToken(bot, deps, signal);
      const updateToken = readFeishuCardUpdateToken(payload);
      const openIds = readFeishuCardUpdateOpenIds(payload);
      const original = readFeishuCardOriginalText(payload);
      if (!token || !updateToken || (!toast?.trim() && !outbound?.elicitation)) {
        return;
      }
      const result = await fetchBotProviderJson<Record<string, unknown>>(
        `${getFeishuBaseUrl(bot)}/open-apis/interactive/v1/card/update`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          signal,
          body: JSON.stringify({
            token: updateToken,
            ...(openIds.length > 0 ? { open_ids: openIds } : {}),
            card: outbound?.elicitation
              ? buildFeishuElicitationCardPayload(outbound)
              : buildFeishuInteractiveCardPayload({
                  botId: bot.id,
                  provider: bot.provider,
                  providerUserId: "",
                  text: original?.trim() || (toast ?? ""),
                }),
          }),
        },
      );
      if (!result.ok) {
        throw new Error(`Feishu update interactive card failed: HTTP ${result.status}`);
      }
      const payloadJson = result.payload ?? {};
      if (payloadJson.code !== 0) {
        throw new Error(
          (typeof payloadJson.msg === "string" ? payloadJson.msg : "") ||
            "Feishu update interactive card failed.",
        );
      }
      return outbound?.elicitation ? { handled: true } : undefined;
    },
    downloadAttachment(bot, attachment, context) {
      return downloadFeishuAttachment(bot, deps, attachment, context);
    },
    parseCallback(payload) {
      if (!isRecord(payload)) {
        return [];
      }
      const botId = typeof payload.botId === "string" ? payload.botId : "";
      if (!botId) {
        return [];
      }
      const inbound = readFeishuTextMessage(botId, payload) ?? readFeishuCardAction(botId, payload);
      return inbound ? [inbound] : [];
    },
  };
}

import type { BotConfigEntry, BotInboundMessage, BotProviderOutbound } from "@zcode/shared";
import { WEIXIN_MESSAGE_STATE, WEIXIN_MESSAGE_TYPE } from "./botsConstants.js";
import { isRecord, readString } from "./botsJson.js";
import type { BotCredentialLoader, BotProvider } from "./botsTypes.js";
import {
  buildWeixinClientId,
  readWeixinMessages,
  readWeixinNextBuf,
  requestWeixinJson,
} from "./botsWeixinApi.js";
import { decryptWeixinCdnMedia } from "./botsWeixinCrypto.js";
import { buildWeixinInboundMessage } from "./botsWeixinParse.js";

export function buildWeixinText(outbound: BotProviderOutbound): string {
  return outbound.text.replace(/\r\n|\r|\n/gu, "\r\n");
}

export function createWeixinBotProvider(deps: BotCredentialLoader): BotProvider {
  return {
    async test(bot) {
      if (!bot.enabled) {
        return { ok: false, message: "Weixin bot is disabled." };
      }
      if (!bot.credentialRef) {
        return {
          ok: false,
          message: "Weixin iLink bot token is missing. Scan the Weixin login QR code first.",
        };
      }
      await requestWeixinJson(bot, deps, "/getconfig");
      return { ok: true, message: "Weixin iLink API is reachable." };
    },
    async send(bot, outbound) {
      await requestWeixinJson(bot, deps, "/sendmessage", {
        msg: {
          from_user_id: bot.providerUserId ?? "",
          to_user_id: outbound.providerUserId,
          client_id: buildWeixinClientId(),
          message_type: WEIXIN_MESSAGE_TYPE,
          message_state: WEIXIN_MESSAGE_STATE,
          ...(outbound.providerContextToken ? { context_token: outbound.providerContextToken } : {}),
          item_list: [{ type: 1, text_item: { text: buildWeixinText(outbound) } }],
        },
      });
    },
    async sendTyping(bot, actor) {
      const config = (await requestWeixinJson(bot, deps, "/getconfig", {
        ilink_user_id: actor.providerUserId,
        ...(actor.providerContextToken ? { context_token: actor.providerContextToken } : {}),
      })) as Record<string, unknown>;
      if (config.typing_ticket) {
        await requestWeixinJson(bot, deps, "/sendtyping", {
          ilink_user_id: actor.providerUserId,
          typing_ticket: config.typing_ticket,
          status: 1,
        });
      }
    },
    async downloadAttachment(_bot, attachment) {
      const aesKey = attachment.providerMetadata?.weixinAesKey;
      if (!attachment.downloadUrl || !aesKey) {
        return null;
      }
      const response = await fetch(attachment.downloadUrl);
      if (!response.ok) {
        throw new Error(`Weixin attachment download failed: HTTP ${response.status}`);
      }
      return {
        attachment,
        data: new Uint8Array(decryptWeixinCdnMedia(new Uint8Array(await response.arrayBuffer()), aesKey)),
      };
    },
    parseCallback(payload) {
      if (!isRecord(payload)) {
        return [];
      }
      const botId = readString(payload, "botId");
      return botId
        ? readWeixinMessages(payload)
            .map((message) => buildWeixinInboundMessage(botId, message))
            .filter((item): item is BotInboundMessage => item !== null)
        : [];
    },
  };
}

/** 发布包 host `getWeixinUpdates`。 */
export async function getWeixinUpdates(input: {
  bot: BotConfigEntry;
  deps: BotCredentialLoader;
  buf?: string;
  signal?: AbortSignal;
}): Promise<{ rawMessageCount: number; messages: BotInboundMessage[]; buf?: string }> {
  const payload = await requestWeixinJson(
    input.bot,
    input.deps,
    "/getupdates",
    { get_updates_buf: input.buf ?? "" },
    input.signal,
  );
  const raw = readWeixinMessages(payload);
  return {
    rawMessageCount: raw.length,
    messages: raw
      .map((message) => buildWeixinInboundMessage(input.bot.id, message))
      .filter((item): item is BotInboundMessage => item !== null),
    buf: readWeixinNextBuf(payload) ?? input.buf,
  };
}

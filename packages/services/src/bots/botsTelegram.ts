import type { BotConfigEntry, BotInboundMessage, BotProviderOutbound } from "@zcode/shared";
import { fetchBotProvider, fetchBotProviderJson } from "./botsHttp.js";
import { isRecord } from "./botsJson.js";
import {
  buildSelectionReplyMarkup,
  buildTelegramCommands,
  decodeTelegramCallbackData,
  splitTelegramText,
  truncateCallbackToast,
} from "./botsTelegramMarkup.js";
import type { BotCredentialLoader, BotProvider, BotSelection } from "./botsTypes.js";

const TELEGRAM_FILE_TIMEOUT_MS = 30_000;

function defaultMimeTypeForAttachmentKind(kind: string): string {
  return kind === "image"
    ? "image/jpeg"
    : kind === "audio"
      ? "audio/mpeg"
      : kind === "video"
        ? "video/mp4"
        : "application/octet-stream";
}

export {
  buildSelectionReplyMarkup,
  buildTelegramCommands,
  decodeTelegramCallbackData,
  splitTelegramText,
  truncateCallbackToast,
} from "./botsTelegramMarkup.js";

function readTelegramFileAttachment(
  value: unknown,
  kind: string,
  fallbackName: string,
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  const fileId = typeof value.file_id === "string" ? value.file_id : "";
  if (!fileId) {
    return null;
  }
  const filename =
    typeof value.file_name === "string" && value.file_name.trim() ? value.file_name : fallbackName;
  return {
    id: fileId,
    kind,
    filename,
    mimeType:
      typeof value.mime_type === "string" && value.mime_type.trim()
        ? value.mime_type
        : defaultMimeTypeForAttachmentKind(kind),
    ...(typeof value.file_size === "number" ? { sizeBytes: value.file_size } : {}),
    providerFileId: fileId,
  };
}

function readTelegramPhotoAttachment(message: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(message.photo) || message.photo.length === 0) {
    return null;
  }
  const last = message.photo.filter(isRecord).at(-1);
  return last ? readTelegramFileAttachment(last, "image", "telegram-photo.jpg") : null;
}

function readTelegramAttachments(message: Record<string, unknown>): unknown[] {
  return [
    readTelegramPhotoAttachment(message),
    readTelegramFileAttachment(message.document, "file", "telegram-document"),
    readTelegramFileAttachment(message.video, "video", "telegram-video.mp4"),
    readTelegramFileAttachment(message.audio, "audio", "telegram-audio"),
    readTelegramFileAttachment(message.voice, "audio", "telegram-voice.ogg"),
  ].filter((item) => item !== null);
}

export function readTelegramPrivateMessage(
  botId: string,
  update: unknown,
): BotInboundMessage | null {
  if (!isRecord(update) || !isRecord(update.message)) {
    return null;
  }
  const message = update.message;
  const chat = isRecord(message.chat) ? message.chat : null;
  const from = isRecord(message.from) ? message.from : null;
  const text =
    typeof message.text === "string" ? message.text : typeof message.caption === "string" ? message.caption : "";
  const userId = typeof from?.id === "number" || typeof from?.id === "string" ? String(from.id) : "";
  const attachments = readTelegramAttachments(message);
  if ((!text && attachments.length === 0) || !userId) {
    return null;
  }
  return {
    botId,
    text,
    ...(attachments.length > 0 ? { attachments } : {}),
    actor: {
      provider: "telegram",
      botId,
      providerUserId: userId,
      displayName:
        typeof from?.username === "string"
          ? from.username
          : typeof from?.first_name === "string"
            ? from.first_name
            : undefined,
      chatType: chat?.type === "private" ? "private" : "group",
      chatId: typeof chat?.id === "number" || typeof chat?.id === "string" ? String(chat.id) : undefined,
      providerMessageId:
        typeof message.message_id === "number" || typeof message.message_id === "string"
          ? String(message.message_id)
          : undefined,
    },
  };
}

export function readTelegramCallbackMessage(botId: string, update: unknown): BotInboundMessage | null {
  if (!isRecord(update) || !isRecord(update.callback_query)) {
    return null;
  }
  const query = update.callback_query;
  const message = isRecord(query.message) ? query.message : null;
  const chat = isRecord(message?.chat) ? message.chat : null;
  const from = isRecord(query.from) ? query.from : null;
  const data = typeof query.data === "string" ? query.data : "";
  const userId = typeof from?.id === "number" || typeof from?.id === "string" ? String(from.id) : "";
  if (!data || !userId) {
    return null;
  }
  return {
    botId,
    text: decodeTelegramCallbackData(data),
    actor: {
      provider: "telegram",
      botId,
      providerUserId: userId,
      displayName:
        typeof from?.username === "string"
          ? from.username
          : typeof from?.first_name === "string"
            ? from.first_name
            : undefined,
      chatType: chat?.type === "private" ? "private" : "group",
      chatId: typeof chat?.id === "number" || typeof chat?.id === "string" ? String(chat.id) : undefined,
      providerMessageId:
        typeof query.id === "string"
          ? query.id
          : typeof message?.message_id === "number" || typeof message?.message_id === "string"
            ? String(message.message_id)
            : undefined,
    },
  };
}

function readTelegramCallbackId(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  const update = isRecord(payload.update) ? payload.update : payload;
  const query = isRecord(update.callback_query) ? update.callback_query : null;
  return typeof query?.id === "string" ? query.id : null;
}

function readTelegramCallbackMessageRef(payload: unknown): { chatId: string; messageId: number } | null {
  if (!isRecord(payload)) {
    return null;
  }
  const update = isRecord(payload.update) ? payload.update : payload;
  const query = isRecord(update.callback_query) ? update.callback_query : null;
  const message = isRecord(query?.message) ? query.message : null;
  const chat = isRecord(message?.chat) ? message.chat : null;
  const chatId = typeof chat?.id === "number" || typeof chat?.id === "string" ? String(chat.id) : "";
  const messageId = typeof message?.message_id === "number" ? message.message_id : null;
  return chatId && messageId !== null ? { chatId, messageId } : null;
}

export function createTelegramBotProvider(deps: BotCredentialLoader): BotProvider {
  async function loadToken(bot: BotConfigEntry): Promise<string | null> {
    return bot.credentialRef ? deps.loadCredential(bot.credentialRef) : null;
  }
  async function getMe(bot: BotConfigEntry): Promise<Record<string, unknown> | null> {
    const token = await loadToken(bot);
    if (!token?.trim()) {
      return null;
    }
    const result = await fetchBotProviderJson<Record<string, unknown>>(
      `https://api.telegram.org/bot${token}/getMe`,
    );
    return result.ok ? (result.payload ?? {}) : null;
  }
  return {
    async test(bot) {
      if (!bot.credentialRef) {
        return { ok: false, message: "Telegram bot token is missing." };
      }
      const me = await getMe(bot);
      if (!me) {
        return { ok: false, message: "Telegram getMe failed." };
      }
      const name =
        (isRecord(me.result) && (me.result.first_name || me.result.username)) || undefined;
      return {
        ok: me.ok === true,
        name: typeof name === "string" ? name : undefined,
        message: me.ok === true ? "Telegram bot is reachable." : String(me.description ?? "Telegram getMe failed."),
      };
    },
    async resolveName(bot) {
      const me = await getMe(bot);
      const name = isRecord(me?.result) ? me.result.first_name || me.result.username : null;
      return me?.ok === true && typeof name === "string" ? name : null;
    },
    async syncCommands(bot) {
      const token = await loadToken(bot);
      if (!token?.trim()) {
        return;
      }
      if (!bot.enabled) {
        await fetchBotProvider(`https://api.telegram.org/bot${token}/deleteMyCommands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }).catch(() => undefined);
        return;
      }
      await fetchBotProvider(`https://api.telegram.org/bot${token}/setMyCommands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commands: buildTelegramCommands(bot) }),
      });
    },
    async send(bot, outbound: BotProviderOutbound) {
      const token = await loadToken(bot);
      if (!token?.trim()) {
        return;
      }
      const markup = outbound.selection ? buildSelectionReplyMarkup(outbound.selection as BotSelection) : undefined;
      const chunks = splitTelegramText(outbound.text);
      for (const [index, chunk] of chunks.entries()) {
        const withMarkup = index === chunks.length - 1 && markup;
        const sent = await fetchBotProvider(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: outbound.providerUserId,
            text: chunk,
            parse_mode: "Markdown",
            ...(withMarkup ? { reply_markup: markup } : {}),
          }),
        });
        if (!sent.ok) {
          await fetchBotProvider(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chat_id: outbound.providerUserId,
              text: chunk,
              ...(withMarkup ? { reply_markup: markup } : {}),
            }),
          });
        }
      }
    },
    async sendTyping(bot, actor) {
      const token = await loadToken(bot);
      if (!token?.trim()) {
        return;
      }
      await fetchBotProvider(`https://api.telegram.org/bot${token}/sendChatAction`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: actor.providerUserId, action: "typing" }),
      });
    },
    async acknowledgeCallback(bot, payload, toast, _outbound, signal) {
      const token = await loadToken(bot);
      const callbackId = readTelegramCallbackId(payload);
      if (!token?.trim() || !callbackId) {
        return;
      }
      await fetchBotProvider(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({
          callback_query_id: callbackId,
          ...(toast?.trim() ? { text: truncateCallbackToast(toast) } : {}),
        }),
      });
      const ref = readTelegramCallbackMessageRef(payload);
      if (ref && toast?.trim()) {
        await fetchBotProvider(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal,
          body: JSON.stringify({
            chat_id: ref.chatId,
            message_id: ref.messageId,
            reply_markup: { inline_keyboard: [] },
          }),
        }).catch(() => undefined);
      }
    },
    async downloadAttachment(bot, attachment) {
      const token = await loadToken(bot);
      if (!token?.trim() || !attachment.providerFileId) {
        return null;
      }
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), TELEGRAM_FILE_TIMEOUT_MS);
      try {
        const fileResponse = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file_id: attachment.providerFileId }),
          signal: abort.signal,
        });
        if (!fileResponse.ok) {
          throw new Error(`Telegram getFile failed: HTTP ${fileResponse.status}`);
        }
        const payload = (await fileResponse.json()) as {
          ok?: boolean;
          description?: string;
          result?: { file_path?: string; file_size?: number };
        };
        const filePath = payload.result?.file_path;
        if (payload.ok !== true || !filePath) {
          throw new Error(payload.description ?? "Telegram getFile did not return file_path.");
        }
        const download = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, {
          signal: abort.signal,
        });
        if (!download.ok) {
          throw new Error(`Telegram file download failed: HTTP ${download.status}`);
        }
        return {
          attachment: {
            ...attachment,
            ...(typeof payload.result?.file_size === "number" ? { sizeBytes: payload.result.file_size } : {}),
          },
          data: new Uint8Array(await download.arrayBuffer()),
        };
      } catch (error) {
        throw isRecord(error) && error.name === "AbortError"
          ? new Error("Telegram file download timed out.")
          : error;
      } finally {
        clearTimeout(timer);
      }
    },
    parseCallback(payload) {
      if (!isRecord(payload)) {
        return [];
      }
      const botId = typeof payload.botId === "string" ? payload.botId : "";
      const update = isRecord(payload.update) ? payload.update : payload;
      if (!botId) {
        return [];
      }
      const inbound = readTelegramPrivateMessage(botId, update) ?? readTelegramCallbackMessage(botId, update);
      return inbound ? [inbound] : [];
    },
  };
}

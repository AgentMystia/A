import type { BotInboundMessage, BotProviderId } from "@zcode/shared";
import { BOT_ELICITATION_FORM_PREFIX } from "./botsConstants.js";
import { buildFeishuElicitationFormCommand } from "./botsFeishuElicitationCard.js";
import { isRecord, readString } from "./botsJson.js";

function readFeishuPayloadProvider(payload: Record<string, unknown>): BotProviderId {
  return readString(payload, "zcodeProvider") === "lark" ? "lark" : "feishu";
}

function readFeishuCallbackEvent(payload: Record<string, unknown>): Record<string, unknown> {
  return (isRecord(payload.event) ? payload.event : null) ?? payload;
}

function readFeishuChatType(value: string): "private" | "group" {
  return value === "group" || value === "group_chat" ? "group" : "private";
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stripFeishuMentions(text: string): string {
  return text
    .replace(/<at\b[^>]*>.*?<\/at>/giu, "")
    .replace(/@\S+/gu, "")
    .trim();
}

/** 发布包 host `inferFeishuAttachmentKind`。 */
export function inferFeishuAttachmentKind(
  messageType: string,
): "image" | "audio" | "video" | "file" {
  return messageType === "image"
    ? "image"
    : messageType === "audio"
      ? "audio"
      : messageType === "media" || messageType === "video"
        ? "video"
        : "file";
}

/** 发布包 host `defaultFeishuMimeType`。 */
export function defaultFeishuMimeType(kind: string): string {
  return kind === "image"
    ? "image/jpeg"
    : kind === "audio"
      ? "audio/mpeg"
      : kind === "video"
        ? "video/mp4"
        : "application/octet-stream";
}

/** 发布包 host `formatFeishuPostToken`。 */
export function formatFeishuPostToken(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(formatFeishuPostToken).filter(Boolean).join("");
  }
  if (!isRecord(value)) {
    return "";
  }
  const tag = readString(value, "tag");
  if (tag === "at") {
    return "";
  }
  const nested = value.content ?? value.children ?? value.elements;
  const nestedText = Array.isArray(nested) ? formatFeishuPostToken(nested) : "";
  const text =
    readString(value, "text") ||
    readString(value, "un_escape_text") ||
    readString(value, "name") ||
    nestedText;
  if (tag === "a") {
    const href = readString(value, "href");
    if (href && href !== text) {
      return text ? `${text} ${href}` : href;
    }
  }
  return text;
}

/** 发布包 host `readFeishuPostLocaleContent`。 */
export function readFeishuPostLocaleContent(content: Record<string, unknown>): unknown {
  const post = isRecord(content.post) ? content.post : null;
  const zh = isRecord(content.zh_cn) ? content.zh_cn : isRecord(post?.zh_cn) ? post.zh_cn : null;
  const en = isRecord(content.en_us) ? content.en_us : isRecord(post?.en_us) ? post.en_us : null;
  return content.content ?? zh?.content ?? en?.content;
}

/** 发布包 host `readFeishuPostLocaleTitle`。 */
export function readFeishuPostLocaleTitle(content: Record<string, unknown>): string {
  const post = isRecord(content.post) ? content.post : null;
  const zh = isRecord(content.zh_cn) ? content.zh_cn : isRecord(post?.zh_cn) ? post.zh_cn : null;
  const en = isRecord(content.en_us) ? content.en_us : isRecord(post?.en_us) ? post.en_us : null;
  return readString(content, "title") || readString(zh, "title") || readString(en, "title");
}

/** 发布包 host `readFeishuPostText`。 */
export function readFeishuPostText(content: unknown): string {
  if (!isRecord(content)) {
    return "";
  }
  const body = readFeishuPostLocaleContent(content);
  const lines = Array.isArray(body)
    ? body.map((item) => formatFeishuPostToken(item).trim()).filter(Boolean)
    : [];
  const title = readFeishuPostLocaleTitle(content).trim();
  const text = lines.join("\n").trim();
  return title && text ? `${title}\n${text}` : text || title;
}

/** 发布包 host `readFeishuAttachment`。 */
export function readFeishuAttachment(
  messageType: string,
  content: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!content) {
    return null;
  }
  const fileKey =
    readString(content, "image_key") ||
    readString(content, "file_key") ||
    readString(content, "media_key") ||
    readString(content, "audio_key") ||
    readString(content, "key");
  if (!fileKey) {
    return null;
  }
  const kind = inferFeishuAttachmentKind(messageType);
  const filename =
    readString(content, "file_name") ||
    readString(content, "filename") ||
    `${messageType}-${fileKey.slice(0, 8)}`;
  const mimeType =
    readString(content, "mime_type") ||
    readString(content, "mimeType") ||
    defaultFeishuMimeType(kind);
  const size = typeof content.size === "number" ? content.size : null;
  return {
    id: fileKey,
    kind,
    filename,
    mimeType,
    ...(size !== null ? { sizeBytes: size } : {}),
    providerFileId: fileKey,
  };
}

/** 发布包 host `readFeishuTextMessage`。 */
export function readFeishuTextMessage(botId: string, payload: unknown): BotInboundMessage | null {
  if (!isRecord(payload)) {
    return null;
  }
  const provider = readFeishuPayloadProvider(payload);
  const event = isRecord(payload.event) ? payload.event : payload;
  const message = isRecord(event.message) ? event.message : null;
  const sender = isRecord(event.sender) ? event.sender : null;
  const senderId = isRecord(sender?.sender_id) ? sender.sender_id : null;
  const content = parseJsonRecord(message?.content);
  const messageType = readString(message, "message_type") || readString(message, "msg_type");
  const attachment = readFeishuAttachment(messageType, content);
  const text = stripFeishuMentions(
    readString(content, "text") ||
      readFeishuPostText(content) ||
      readString(event, "text_without_at_bot") ||
      readString(event, "text"),
  );
  const userId =
    readString(senderId, "open_id") ||
    readString(senderId, "user_id") ||
    readString(senderId, "union_id") ||
    readString(event, "open_id") ||
    readString(event, "user_id") ||
    readString(event, "union_id");
  const chatId = readString(message, "chat_id") || readString(event, "open_chat_id");
  const messageId = readString(message, "message_id");
  if ((!text && !attachment) || !userId) {
    return null;
  }
  const chatType = readFeishuChatType(
    readString(message, "chat_type") || readString(event, "chat_type"),
  );
  return {
    botId,
    text,
    ...(attachment ? { attachments: [attachment] } : {}),
    actor: {
      provider,
      botId,
      providerUserId: userId,
      chatType,
      chatId: chatType === "group" && chatId ? chatId : undefined,
      providerMessageId: messageId || undefined,
    },
  };
}

/** 发布包 host `readFeishuCardAction`。 */
export function readFeishuCardAction(botId: string, payload: unknown): BotInboundMessage | null {
  if (!isRecord(payload)) {
    return null;
  }
  const provider = readFeishuPayloadProvider(payload);
  const event = readFeishuCallbackEvent(payload);
  const action = isRecord(event.action) ? event.action : null;
  const value = isRecord(action?.value) ? action.value : null;
  const behaviors = Array.isArray(action?.behaviors) ? action.behaviors.find(isRecord) : null;
  const behaviorValue = isRecord(behaviors?.value) ? behaviors.value : null;
  const command =
    readString(value, "command") ||
    readString(value, "text") ||
    readString(behaviorValue, "command") ||
    readString(behaviorValue, "text");
  const formValue = isRecord(action?.form_value) ? action.form_value : null;
  const text = command.includes(BOT_ELICITATION_FORM_PREFIX)
    ? buildFeishuElicitationFormCommand(command.split(/\s+/u)[1] ?? "", formValue?.answer)
    : command;
  const userOperator = isRecord(event.operator) ? event.operator : null;
  const operatorId = isRecord(userOperator?.operator_id) ? userOperator.operator_id : null;
  const userId =
    readString(operatorId, "open_id") ||
    readString(userOperator, "open_id") ||
    readString(event, "open_id") ||
    readString(event, "user_id") ||
    readString(payload, "open_id") ||
    readString(payload, "user_id");
  const context = isRecord(event.context) ? event.context : null;
  const chatType = readFeishuChatType(
    readString(context, "chat_type") ||
      readString(event, "chat_type") ||
      readString(payload, "chat_type"),
  );
  const chatId = readString(context, "open_chat_id") || readString(context, "chat_id");
  const header = isRecord(payload.header) ? payload.header : null;
  const message = isRecord(event.message) ? event.message : null;
  const messageId =
    readString(event, "event_id") ||
    readString(header, "event_id") ||
    readString(payload, "uuid") ||
    readString(payload, "event_id") ||
    readString(context, "open_message_id") ||
    readString(context, "message_id") ||
    readString(message, "message_id") ||
    readString(action, "value_id");
  if (!text || !userId) {
    return null;
  }
  return {
    botId,
    text,
    actor: {
      provider,
      botId,
      providerUserId: userId,
      chatType,
      chatId: chatType === "group" && chatId ? chatId : undefined,
      ...(messageId ? { providerMessageId: messageId } : {}),
    },
  };
}

export function readFeishuCardUpdateToken(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }
  const event = readFeishuCallbackEvent(payload);
  const action = isRecord(event.action) ? event.action : null;
  const context = isRecord(event.context) ? event.context : null;
  return (
    readString(event, "token") ||
    readString(event, "card_update_token") ||
    readString(payload, "token") ||
    readString(action, "token") ||
    readString(context, "token")
  );
}

export function readFeishuCardUpdateOpenIds(payload: unknown): string[] {
  if (!isRecord(payload)) {
    return [];
  }
  const event = readFeishuCallbackEvent(payload);
  const operator = isRecord(event.operator) ? event.operator : null;
  const operatorId = isRecord(operator?.operator_id) ? operator.operator_id : null;
  const openId =
    readString(operatorId, "open_id") ||
    readString(operator, "open_id") ||
    readString(event, "open_id");
  return openId ? [openId] : [];
}

export function readFeishuCardOriginalText(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  const event = readFeishuCallbackEvent(payload);
  const action = isRecord(event.action) ? event.action : null;
  const value = isRecord(action?.value) ? action.value : null;
  const behaviors = Array.isArray(action?.behaviors) ? action.behaviors.find(isRecord) : null;
  const behaviorValue = isRecord(behaviors?.value) ? behaviors.value : null;
  return (
    readString(value, "zcodeCardText") ||
    readString(value, "cardText") ||
    readString(behaviorValue, "zcodeCardText") ||
    null
  );
}

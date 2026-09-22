import type { BotInboundMessage, BotProviderId } from "@zcode/shared";
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
  return text.replace(/<at\b[^>]*>.*?<\/at>/giu, "").replace(/@\S+/gu, "").trim();
}

function readFeishuAttachment(
  messageType: string,
  content: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!content) {
    return null;
  }
  const kind = messageType === "image" ? "image" : messageType === "media" || messageType === "file" ? "file" : "";
  const fileKey = readString(content, "image_key") || readString(content, "file_key") || readString(content, "file_token");
  if (!kind || !fileKey) {
    return null;
  }
  return {
    id: fileKey,
    kind,
    filename: readString(content, "file_name") || `feishu-${kind}`,
    mimeType: kind === "image" ? "image/jpeg" : "application/octet-stream",
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
    readString(content, "text") || readString(event, "text_without_at_bot") || readString(event, "text"),
  );
  const userId =
    readString(senderId, "open_id") ||
    readString(senderId, "user_id") ||
    readString(event, "open_id") ||
    readString(event, "user_id");
  const chatId = readString(message, "chat_id") || readString(event, "open_chat_id");
  const messageId = readString(message, "message_id");
  if ((!text && !attachment) || !userId) {
    return null;
  }
  const chatType = readFeishuChatType(readString(message, "chat_type") || readString(event, "chat_type"));
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
  const command = readString(value, "command") || readString(value, "text") || readString(behaviorValue, "command");
  const userOperator = isRecord(event.operator) ? event.operator : null;
  const operatorId = isRecord(userOperator?.operator_id) ? userOperator.operator_id : null;
  const userId =
    readString(operatorId, "open_id") ||
    readString(userOperator, "open_id") ||
    readString(event, "open_id") ||
    readString(payload, "open_id");
  const context = isRecord(event.context) ? event.context : null;
  const chatType = readFeishuChatType(
    readString(context, "chat_type") || readString(event, "chat_type") || readString(payload, "chat_type"),
  );
  const chatId = readString(context, "open_chat_id") || readString(context, "chat_id");
  const header = isRecord(payload.header) ? payload.header : null;
  const messageId =
    readString(event, "event_id") ||
    readString(header, "event_id") ||
    readString(payload, "uuid") ||
    readString(context, "open_message_id") ||
    readString(action, "token");
  if (!command || !userId) {
    return null;
  }
  return {
    botId,
    text: command,
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
  const openId = readString(operatorId, "open_id") || readString(operator, "open_id") || readString(event, "open_id");
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

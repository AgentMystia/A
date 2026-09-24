import type { BotInboundMessage } from "@zcode/shared";
import { isRecord, readNumber, readNumberOrString, readString } from "./botsJson.js";

function inferMimeTypeFromFilename(filename: string): string {
  return /\.svg$/iu.test(filename)
    ? "image/svg+xml"
    : /\.png$/iu.test(filename)
      ? "image/png"
      : /\.jpe?g$/iu.test(filename)
        ? "image/jpeg"
        : /\.gif$/iu.test(filename)
          ? "image/gif"
          : /\.webp$/iu.test(filename)
            ? "image/webp"
            : "";
}

function inferWeixinAttachmentKind(item: Record<string, unknown>): string {
  if (isRecord(item.image_item)) {
    return "image";
  }
  const kind =
    `${readString(item, "kind")} ${readString(item, "media_type")} ${readString(item, "mime_type")} ${readString(item, "filename")}`.toLowerCase();
  if (
    kind.includes("image") ||
    kind.includes("photo") ||
    /\.(svg|png|jpe?g|gif|webp|heic|bmp)$/iu.test(kind)
  ) {
    return "image";
  }
  if (kind.includes("audio") || kind.includes("voice")) {
    return "audio";
  }
  if (kind.includes("video")) {
    return "video";
  }
  return "file";
}

function readWeixinTextItem(item: unknown): string {
  if (!isRecord(item)) {
    return "";
  }
  const textItem = isRecord(item.text_item) ? item.text_item : null;
  return readString(textItem, "text") || readString(item, "text") || readString(item, "content");
}

export function readWeixinText(message: Record<string, unknown>): string {
  const direct =
    readString(message, "text") || readString(message, "content") || readString(message, "message");
  if (direct) {
    return direct;
  }
  const nested = isRecord(message.msg)
    ? message.msg
    : isRecord(message.message)
      ? message.message
      : null;
  const items = Array.isArray(message.item_list)
    ? message.item_list
    : Array.isArray(nested?.item_list)
      ? nested.item_list
      : [];
  return (
    items.map(readWeixinTextItem).filter(Boolean).join("\n") ||
    readString(nested, "text") ||
    readString(nested, "content")
  );
}

function readWeixinAttachmentItem(item: unknown, index: number): Record<string, unknown> | null {
  if (!isRecord(item) || readWeixinTextItem(item)) {
    return null;
  }
  const nested = isRecord(item.image_item)
    ? item.image_item
    : isRecord(item.file_item)
      ? item.file_item
      : isRecord(item.video_item)
        ? item.video_item
        : isRecord(item.audio_item)
          ? item.audio_item
          : isRecord(item.media_item)
            ? item.media_item
            : item;
  const media = isRecord(nested.media) ? nested.media : null;
  const merged = media ? { ...nested, ...media } : nested;
  const fileId =
    readNumberOrString(merged, "file_id") ||
    readNumberOrString(merged, "media_id") ||
    readNumberOrString(merged, "id");
  const url =
    readString(merged, "url") ||
    readString(merged, "download_url") ||
    readString(merged, "downloadUrl");
  const dataBase64 = readString(merged, "data_base64") || readString(merged, "dataBase64");
  if (!fileId && !url && !dataBase64) {
    return null;
  }
  const kind = inferWeixinAttachmentKind({ ...item, ...merged });
  const filename =
    readString(merged, "filename") ||
    readString(merged, "file_name") ||
    (kind === "image" ? `weixin-image-${index + 1}.jpg` : `weixin-attachment-${index + 1}`);
  const mimeType =
    readString(merged, "mime_type") ||
    inferMimeTypeFromFilename(filename) ||
    (kind === "image"
      ? "image/jpeg"
      : kind === "audio"
        ? "audio/mpeg"
        : kind === "video"
          ? "video/mp4"
          : "application/octet-stream");
  const size =
    readNumber(merged, "size") ??
    readNumber(merged, "file_size") ??
    readNumber(merged, "sizeBytes");
  const aesKey =
    readString(merged, "aes_key") || readString(merged, "aesKey") || readString(merged, "aeskey");
  return {
    id: fileId || url || `weixin-${index + 1}`,
    kind,
    filename,
    mimeType,
    ...(size ? { sizeBytes: size } : {}),
    ...(fileId ? { providerFileId: fileId } : {}),
    ...(url ? { downloadUrl: url } : {}),
    ...(dataBase64 ? { dataBase64 } : {}),
    ...(aesKey ? { providerMetadata: { weixinAesKey: aesKey } } : {}),
  };
}

/** 发布包 host `readWeixinDirectAttachment`。 */
export function readWeixinDirectAttachment(
  value: unknown,
  index: number,
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = readString(value, "kind");
  if (kind !== "image" && kind !== "audio" && kind !== "video" && kind !== "file") {
    return null;
  }
  const id = readString(value, "id") || `weixin-${index + 1}`;
  const filename = readString(value, "filename") || `${id}.${kind}`;
  const mimeType =
    readString(value, "mimeType") ||
    readString(value, "mime_type") ||
    (kind === "image"
      ? "image/jpeg"
      : kind === "audio"
        ? "audio/mpeg"
        : kind === "video"
          ? "video/mp4"
          : "application/octet-stream");
  const size = readNumber(value, "sizeBytes") ?? readNumber(value, "size");
  const providerFileId = readString(value, "providerFileId") || readString(value, "file_id");
  const downloadUrl = readString(value, "downloadUrl") || readString(value, "download_url");
  const dataBase64 = readString(value, "dataBase64") || readString(value, "data_base64");
  const metadata = isRecord(value.providerMetadata)
    ? Object.fromEntries(
        Object.entries(value.providerMetadata).filter((entry) => typeof entry[1] === "string"),
      )
    : null;
  return {
    id,
    kind,
    filename,
    mimeType,
    ...(size !== null ? { sizeBytes: size } : {}),
    ...(providerFileId ? { providerFileId } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(dataBase64 ? { dataBase64 } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { providerMetadata: metadata } : {}),
  };
}

export function readWeixinAttachments(message: Record<string, unknown>): unknown[] {
  const nested = isRecord(message.msg)
    ? message.msg
    : isRecord(message.message)
      ? message.message
      : null;
  const items = Array.isArray(message.item_list)
    ? message.item_list
    : Array.isArray(nested?.item_list)
      ? nested.item_list
      : [];
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
    : Array.isArray(nested?.attachments)
      ? nested.attachments
      : [];
  return [
    ...items
      .map((item, index) => readWeixinAttachmentItem(item, index))
      .filter((item) => item !== null),
    ...attachments.flatMap((item, index) => {
      const direct = readWeixinDirectAttachment(item, index);
      return direct ? [direct] : [];
    }),
  ];
}

export function readWeixinUserId(message: Record<string, unknown>): string {
  const from = isRecord(message.from) ? message.from : null;
  const sender = isRecord(message.sender) ? message.sender : null;
  return (
    readString(message, "from_user_id") ||
    readString(message, "from") ||
    readString(message, "user_id") ||
    readString(from, "id") ||
    readString(from, "wxid") ||
    readString(sender, "id") ||
    readString(sender, "wxid")
  );
}

export function readWeixinDisplayName(message: Record<string, unknown>): string | undefined {
  const from = isRecord(message.from) ? message.from : null;
  const sender = isRecord(message.sender) ? message.sender : null;
  const nested = isRecord(message.msg)
    ? message.msg
    : isRecord(message.message)
      ? message.message
      : null;
  return (
    readString(message, "name") ||
    readString(message, "displayName") ||
    readString(message, "nickname") ||
    readString(from, "name") ||
    readString(sender, "name") ||
    readString(nested, "sender_name") ||
    undefined
  );
}

export function readWeixinChatId(message: Record<string, unknown>): string | undefined {
  return (
    readString(message, "room") ||
    readString(message, "room_id") ||
    readString(message, "chat") ||
    readString(message, "chat_id") ||
    undefined
  );
}

export function readWeixinMessageId(message: Record<string, unknown>): string | undefined {
  const nested = isRecord(message.msg)
    ? message.msg
    : isRecord(message.message)
      ? message.message
      : null;
  const text =
    readString(message, "id") ||
    readString(message, "msgid") ||
    readNumberOrString(message, "message_id") ||
    readString(nested, "id") ||
    readString(nested, "msgid");
  if (text) {
    return text;
  }
  const numeric =
    readNumber(message, "id") ?? readNumber(message, "msgid") ?? readNumber(nested, "id");
  return numeric === null ? undefined : String(numeric);
}

export function readWeixinContextToken(message: Record<string, unknown>): string | undefined {
  const nested = isRecord(message.msg)
    ? message.msg
    : isRecord(message.message)
      ? message.message
      : null;
  return (
    readString(message, "context_token") ||
    readString(message, "contextToken") ||
    readString(nested, "context_token") ||
    undefined
  );
}

/** 发布包 host `buildInboundMessage`：message_type=2 视为非用户消息。 */
export function buildInboundMessage(
  botId: string,
  message: unknown,
): BotInboundMessage | null {
  if (!isRecord(message) || readNumber(message, "message_type") === 2) {
    return null;
  }
  const text = readWeixinText(message).trim();
  const attachments = readWeixinAttachments(message);
  const userId = readWeixinUserId(message).trim();
  if ((!text && attachments.length === 0) || !userId) {
    return null;
  }
  const chatId = readWeixinChatId(message);
  return {
    botId,
    text,
    ...(attachments.length > 0 ? { attachments } : {}),
    actor: {
      provider: "weixin",
      botId,
      providerUserId: userId,
      displayName: readWeixinDisplayName(message),
      chatType: chatId ? "group" : "private",
      chatId,
      providerMessageId: readWeixinMessageId(message),
      providerContextToken: readWeixinContextToken(message),
    },
  };
}

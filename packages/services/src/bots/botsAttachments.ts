import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  BotActor,
  BotConfigEntry,
  BotInboundMessage,
  ZCodePromptAttachment,
} from "@zcode/shared";
import { getAppConfigDir } from "../paths.js";
import {
  BOT_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
  BOT_ATTACHMENT_MAX_BYTES,
  BOT_ATTACHMENT_MAX_COUNT,
} from "./botsConstants.js";
import type { BotMessageLocale } from "./botsCopy.js";
import { copy } from "./botsInboundText.js";
import { isRecord } from "./botsNormalize.js";
import type { BotProvider } from "./botsTypes.js";

export interface BotInboundAttachment {
  id?: string;
  kind?: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  dataBase64?: string;
  localPath?: string;
  downloadUrl?: string;
  providerFileId?: string;
  providerMetadata?: { weixinAesKey?: string };
}

export interface PreparedBotMessage {
  content: string;
  zcodeAttachments: ZCodePromptAttachment[];
}

/** 发布包 host `sanitizeAttachmentFilename`。 */
export function sanitizeAttachmentFilename(filename: string): string {
  const sanitized = Array.from(filename.trim())
    .map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? "_" : char))
    .join("");
  return sanitized.length > 0 ? sanitized.slice(0, 160) : "attachment";
}

/** 发布包 host `formatAttachmentSize`。 */
export function formatAttachmentSize(sizeBytes?: number): string {
  if (!sizeBytes || sizeBytes <= 0) {
    return "unknown size";
  }
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (sizeBytes >= 1024) {
    return `${Math.ceil(sizeBytes / 1024)}KB`;
  }
  return `${sizeBytes}B`;
}

/** 发布包 host `formatAttachmentRejectedReason`。 */
export function formatAttachmentRejectedReason(error: unknown, locale: BotMessageLocale): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/exceeds 5MB/i.test(message)) {
    return copy(locale, "attachmentTooLarge");
  }
  return /attachment download failed/i.test(message) ||
    /file download failed/i.test(message) ||
    /download .+ failed: HTTP/i.test(message) ||
    /file download timed out/i.test(message) ||
    /attachment download timed out/i.test(message) ||
    /download .+ timed out/i.test(message)
    ? copy(locale, "attachmentDownloadUnavailable")
    : message;
}

/** 发布包 host `buildAttachmentCachePath`。 */
export function buildAttachmentCachePath(input: {
  botId: string;
  providerMessageId?: string;
  attachment: BotInboundAttachment;
}): string {
  const messageId = input.providerMessageId?.trim() || `message-${Date.now()}`;
  const digest = createHash("sha256")
    .update(`${input.botId}:${messageId}:${input.attachment.id}`)
    .digest("hex")
    .slice(0, 16);
  return join(
    getAppConfigDir(),
    "bot-attachments",
    sanitizeAttachmentFilename(input.botId),
    sanitizeAttachmentFilename(messageId),
    `${digest}-${sanitizeAttachmentFilename(input.attachment.filename)}`,
  );
}

/** 发布包 host `fetchAttachmentDownloadUrl`。 */
export async function fetchAttachmentDownloadUrl(
  attachment: BotInboundAttachment,
): Promise<Uint8Array | null> {
  if (!attachment.downloadUrl) {
    return null;
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), BOT_ATTACHMENT_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(attachment.downloadUrl, { signal: abort.signal });
    if (!response.ok) {
      throw new Error(`download ${attachment.filename} failed: HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw isRecord(error) && error.name === "AbortError"
      ? new Error(`download ${attachment.filename} timed out.`)
      : error;
  } finally {
    clearTimeout(timer);
  }
}

/** 发布包 host `resolveAttachmentBytes`。 */
export async function resolveAttachmentBytes(
  bot: BotConfigEntry,
  attachment: BotInboundAttachment,
  actor: BotActor,
  providers: Record<string, BotProvider | null>,
): Promise<{ attachment: BotInboundAttachment; data: Uint8Array } | null> {
  if (attachment.dataBase64) {
    return { attachment, data: Buffer.from(attachment.dataBase64, "base64") };
  }
  if (attachment.localPath) {
    return { attachment, data: await readFile(attachment.localPath) };
  }
  const downloaded = await providers[bot.provider]?.downloadAttachment?.(bot, attachment, actor);
  if (downloaded) {
    return {
      attachment: { ...attachment, ...(downloaded.attachment as BotInboundAttachment) },
      data: downloaded.data,
    };
  }
  const bytes = await fetchAttachmentDownloadUrl(attachment);
  return bytes ? { attachment, data: bytes } : null;
}

/** 发布包 host `cacheResolvedAttachment`。 */
export async function cacheResolvedAttachment(input: {
  bot: BotConfigEntry;
  message: BotInboundMessage;
  attachment: BotInboundAttachment;
  data: Uint8Array;
}): Promise<BotInboundAttachment> {
  const path = buildAttachmentCachePath({
    botId: input.bot.id,
    providerMessageId: input.message.actor.providerMessageId,
    attachment: input.attachment,
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, input.data);
  return {
    ...input.attachment,
    localPath: path,
    sizeBytes: input.data.byteLength,
  };
}

const readInboundAttachment = (() => {
  return (value: unknown): BotInboundAttachment | null => {
    if (!isRecord(value) || typeof value.filename !== "string" || !value.filename.trim()) {
      return null;
    }
    return {
      ...(typeof value.id === "string" ? { id: value.id } : {}),
      ...(typeof value.kind === "string" ? { kind: value.kind } : {}),
      filename: value.filename,
      mimeType: typeof value.mimeType === "string" ? value.mimeType : "application/octet-stream",
      ...(typeof value.sizeBytes === "number" ? { sizeBytes: value.sizeBytes } : {}),
      ...(typeof value.dataBase64 === "string" ? { dataBase64: value.dataBase64 } : {}),
      ...(typeof value.localPath === "string" ? { localPath: value.localPath } : {}),
      ...(typeof value.downloadUrl === "string" ? { downloadUrl: value.downloadUrl } : {}),
      ...(typeof value.providerFileId === "string" ? { providerFileId: value.providerFileId } : {}),
    };
  };
})();

const toPromptAttachment = (() => {
  return (attachment: BotInboundAttachment, dataBase64: string): ZCodePromptAttachment | null => {
    if (attachment.kind === "image") {
      return {
        kind: "image",
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        dataBase64,
        ...(attachment.localPath ? { localPath: attachment.localPath } : {}),
        ...(typeof attachment.sizeBytes === "number" ? { sizeBytes: attachment.sizeBytes } : {}),
      };
    }
    if (attachment.kind === "audio") {
      return {
        kind: "audio",
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        dataBase64,
        ...(attachment.localPath ? { localPath: attachment.localPath } : {}),
      };
    }
    return null;
  };
})();

/** 发布包 host `prepareBotMessageContent`。 */
export async function prepareBotMessageContent(
  bot: BotConfigEntry,
  message: BotInboundMessage,
  locale: BotMessageLocale,
  providers: Record<string, BotProvider | null>,
): Promise<PreparedBotMessage> {
  const incoming = (message.attachments ?? [])
    .slice(0, BOT_ATTACHMENT_MAX_COUNT)
    .flatMap((item) => {
      const attachment = readInboundAttachment(item);
      return attachment ? [attachment] : [];
    });
  const zcodeAttachments: ZCodePromptAttachment[] = [];
  const notes: string[] = [];
  for (const attachment of incoming) {
    const resolved = await resolveAttachmentBytes(bot, attachment, message.actor, providers);
    if (!resolved) {
      notes.push(
        `附件：${attachment.filename} (${attachment.mimeType}, ${formatAttachmentSize(attachment.sizeBytes)})，未能下载。`,
      );
      continue;
    }
    if (resolved.data.byteLength > BOT_ATTACHMENT_MAX_BYTES) {
      throw new Error(`${resolved.attachment.filename} exceeds 5MB.`);
    }
    const cached = await cacheResolvedAttachment({
      bot,
      message,
      attachment: resolved.attachment,
      data: resolved.data,
    });
    const dataBase64 = Buffer.from(resolved.data).toString("base64");
    const prompt = toPromptAttachment(cached, dataBase64);
    if (prompt) {
      zcodeAttachments.push(prompt);
      notes.push(
        `附件：${cached.filename} (${cached.mimeType}, ${formatAttachmentSize(cached.sizeBytes)})，已作为${cached.kind === "image" ? "图片" : "音频"}输入提供，并保存到：${cached.localPath}。如需读取附件，请直接使用这个本地路径，不要下载或访问临时/远程 URL。`,
      );
      continue;
    }
    notes.push(
      `附件：${cached.filename} (${cached.mimeType}, ${formatAttachmentSize(cached.sizeBytes)})，已保存到：${cached.localPath}`,
    );
  }
  return {
    content: [
      message.text.trim() || (incoming.length > 0 ? copy(locale, "attachmentOnlyPrompt") : ""),
      ...notes,
    ]
      .filter(Boolean)
      .join("\n\n"),
    zcodeAttachments,
  };
}

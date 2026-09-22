import type { BotConfigEntry, BotProviderOutbound } from "@zcode/shared";
import { FEISHU_ATTACHMENT_TIMEOUT_MS } from "./botsConstants.js";
import { fetchBotProviderJson } from "./botsHttp.js";
import { isRecord } from "./botsJson.js";
import type { BotCredentialLoader } from "./botsTypes.js";
import {
  createFeishuMessageError,
  getFeishuBaseUrl,
  resolveFeishuReceiveIdType,
} from "./botsFeishuUrls.js";
import { readTenantAccessToken } from "./botsFeishuToken.js";

const typingReactions = new Map<string, string>();

export async function sendFeishuInteractiveCard(
  bot: BotConfigEntry,
  token: string,
  receiveId: string,
  card: unknown,
  signal?: AbortSignal,
): Promise<string | null> {
  const receiveIdType = resolveFeishuReceiveIdType(receiveId);
  const result = await fetchBotProviderJson<Record<string, unknown>>(
    `${getFeishuBaseUrl(bot)}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ receive_id: receiveId, msg_type: "interactive", content: JSON.stringify(card) }),
      signal,
    },
  );
  const payload = result.payload ?? {};
  if (!result.ok || payload.code !== 0) {
    throw createFeishuMessageError("send interactive message", result.status, payload, result.responseLogId, receiveIdType);
  }
  const data = isRecord(payload.data) ? payload.data : null;
  return typeof data?.message_id === "string" ? data.message_id : null;
}

export async function updateFeishuInteractiveMessage(
  bot: BotConfigEntry,
  token: string,
  handle: { providerMessageId: string },
  card: unknown,
  signal?: AbortSignal,
): Promise<void> {
  const result = await fetchBotProviderJson<Record<string, unknown>>(
    `${getFeishuBaseUrl(bot)}/open-apis/im/v1/messages/${encodeURIComponent(handle.providerMessageId)}`,
    {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ msg_type: "interactive", content: JSON.stringify(card) }),
      signal,
    },
  );
  const payload = result.payload ?? {};
  if (!result.ok || payload.code !== 0) {
    throw createFeishuMessageError("update streaming card", result.status, payload, result.responseLogId);
  }
}

export async function deleteFeishuInteractiveMessage(
  bot: BotConfigEntry,
  token: string,
  handle: { providerMessageId: string },
): Promise<void> {
  const result = await fetchBotProviderJson<Record<string, unknown>>(
    `${getFeishuBaseUrl(bot)}/open-apis/im/v1/messages/${encodeURIComponent(handle.providerMessageId)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
  );
  if (!result.ok) {
    throw new Error(`Feishu recall interaction card failed: HTTP ${result.status}`);
  }
  const payload = result.payload ?? {};
  if (payload.code !== 0) {
    throw new Error((typeof payload.msg === "string" ? payload.msg : "") || "Feishu recall interaction card failed.");
  }
}

export async function addFeishuTypingReaction(
  bot: BotConfigEntry,
  deps: BotCredentialLoader,
  messageId: string,
): Promise<void> {
  const token = await readTenantAccessToken(bot, deps);
  if (!token) {
    return;
  }
  const key = `${bot.id}:${messageId}`;
  if (typingReactions.has(key)) {
    return;
  }
  const result = await fetchBotProviderJson<Record<string, unknown>>(
    `${getFeishuBaseUrl(bot)}/open-apis/im/v1/messages/${messageId}/reactions`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ reaction_type: { emoji_type: "Typing" } }),
    },
  );
  if (!result.ok) {
    throw new Error(`Feishu add typing reaction failed: HTTP ${result.status}`);
  }
  const payload = result.payload ?? {};
  if (payload.code !== 0) {
    throw new Error((typeof payload.msg === "string" ? payload.msg : "") || "Feishu add typing reaction failed.");
  }
  const data = isRecord(payload.data) ? payload.data : null;
  if (typeof data?.reaction_id === "string") {
    typingReactions.set(key, data.reaction_id);
  }
}

export async function deleteFeishuTypingReaction(
  bot: BotConfigEntry,
  deps: BotCredentialLoader,
  messageId: string,
): Promise<void> {
  const key = `${bot.id}:${messageId}`;
  const reactionId = typingReactions.get(key);
  if (!reactionId) {
    return;
  }
  const token = await readTenantAccessToken(bot, deps);
  if (!token) {
    return;
  }
  const result = await fetchBotProviderJson<Record<string, unknown>>(
    `${getFeishuBaseUrl(bot)}/open-apis/im/v1/messages/${messageId}/reactions/${reactionId}`,
    { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
  );
  if (!result.ok) {
    throw new Error(`Feishu delete typing reaction failed: HTTP ${result.status}`);
  }
  const payload = result.payload ?? {};
  if (payload.code !== 0) {
    throw new Error((typeof payload.msg === "string" ? payload.msg : "") || "Feishu delete typing reaction failed.");
  }
  typingReactions.delete(key);
}

export async function downloadFeishuAttachment(
  bot: BotConfigEntry,
  deps: BotCredentialLoader,
  attachment: { providerFileId?: string; kind?: string },
  context?: { providerMessageId?: string },
): Promise<{ attachment: unknown; data: Uint8Array } | null> {
  const token = await readTenantAccessToken(bot, deps);
  if (!token || !attachment.providerFileId || !context?.providerMessageId) {
    return null;
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FEISHU_ATTACHMENT_TIMEOUT_MS);
  try {
    const kind = attachment.kind === "image" ? "image" : attachment.kind === "video" ? "media" : attachment.kind;
    const response = await fetch(
      `${getFeishuBaseUrl(bot)}/open-apis/im/v1/messages/${encodeURIComponent(context.providerMessageId)}/resources/${encodeURIComponent(attachment.providerFileId)}?type=${kind}`,
      { headers: { authorization: `Bearer ${token}` }, signal: abort.signal },
    );
    if (!response.ok) {
      throw new Error(`Feishu attachment download failed: HTTP ${response.status}`);
    }
    return { attachment, data: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    throw isRecord(error) && error.name === "AbortError"
      ? new Error("Feishu attachment download timed out.")
      : error;
  } finally {
    clearTimeout(timer);
  }
}

export async function readFeishuAppDisplayName(
  bot: BotConfigEntry,
  deps: BotCredentialLoader,
): Promise<string | null> {
  if (!bot.feishuAppId) {
    return null;
  }
  const token = await readTenantAccessToken(bot, deps);
  if (!token) {
    return null;
  }
  const result = await fetchBotProviderJson<Record<string, unknown>>(
    `${getFeishuBaseUrl(bot)}/open-apis/application/v6/applications/${bot.feishuAppId}?lang=zh_cn`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const data = isRecord(result.payload?.data) ? result.payload.data : null;
  const app = isRecord(data?.app) ? data.app : null;
  return typeof app?.app_name === "string" ? app.app_name.trim() : null;
}

export type { BotProviderOutbound };

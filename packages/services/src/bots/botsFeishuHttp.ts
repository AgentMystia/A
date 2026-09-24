import type { BotConfigEntry, BotProviderOutbound } from "@zcode/shared";
import { FEISHU_ATTACHMENT_TIMEOUT_MS } from "./botsConstants.js";
import { fetchBotProviderJson } from "./botsHttp.js";
import { isRecord } from "./botsJson.js";
import type { BotCredentialLoader } from "./botsTypes.js";
import {
  createFeishuMessageError,
  getFeishuBaseUrl,
  getFeishuDomainProvider,
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
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      }),
      signal,
    },
  );
  const payload = result.payload ?? {};
  if (!result.ok || payload.code !== 0) {
    throw createFeishuMessageError(
      "send interactive message",
      result.status,
      payload,
      result.responseLogId,
      receiveIdType,
    );
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
    throw createFeishuMessageError(
      "update streaming card",
      result.status,
      payload,
      result.responseLogId,
    );
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
    throw new Error(
      (typeof payload.msg === "string" ? payload.msg : "") ||
        "Feishu recall interaction card failed.",
    );
  }
}

/** 发布包 host `getFeishuTypingReactionKey`。内联模板不会留下这个 keepName。 */
function getFeishuTypingReactionKey(bot: BotConfigEntry, messageId: string): string {
  return `${bot.id}:${messageId}`;
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
  const key = getFeishuTypingReactionKey(bot, messageId);
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
    throw new Error(
      (typeof payload.msg === "string" ? payload.msg : "") || "Feishu add typing reaction failed.",
    );
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
  const key = getFeishuTypingReactionKey(bot, messageId);
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
    throw new Error(
      (typeof payload.msg === "string" ? payload.msg : "") ||
        "Feishu delete typing reaction failed.",
    );
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
    const kind =
      attachment.kind === "image"
        ? "image"
        : attachment.kind === "video"
          ? "media"
          : attachment.kind;
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

/** 发布包 host `resolveFeishuAppDisplayName`。 */
export function resolveFeishuAppDisplayName(payload: Record<string, unknown>): string | null {
  const data = isRecord(payload.data) ? payload.data : null;
  const app = isRecord(data?.app) ? data.app : null;
  const appName = typeof app?.app_name === "string" ? app.app_name.trim() : "";
  if (appName) {
    return appName;
  }
  const primary = typeof app?.primary_language === "string" ? app.primary_language.trim() : "";
  const i18n = Array.isArray(app?.i18n) ? app.i18n.filter(isRecord) : [];
  const primaryName = i18n.find((item) => item.i18n_key === primary)?.name;
  const primaryTrimmed = typeof primaryName === "string" ? primaryName.trim() : "";
  if (primaryTrimmed) {
    return primaryTrimmed;
  }
  const fallback = i18n.find((item) => typeof item.name === "string" && item.name.trim());
  return typeof fallback?.name === "string" ? fallback.name.trim() : null;
}

/** 发布包 host `fetchFeishuAppDisplayName`。 */
export async function fetchFeishuAppDisplayName(
  bot: BotConfigEntry,
  token: string,
  appId: string,
): Promise<string | null> {
  const result = await fetchBotProviderJson<Record<string, unknown>>(
    `${getFeishuBaseUrl(bot)}/open-apis/application/v6/applications/${appId}?lang=zh_cn`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!result.ok) {
    throw new Error(`Feishu get application info failed app=${appId}: HTTP ${result.status}`);
  }
  const payload = result.payload ?? {};
  if (payload.code !== 0) {
    throw new Error(
      (typeof payload.msg === "string" && payload.msg) ||
        `Feishu get application info failed app=${appId}.`,
    );
  }
  return resolveFeishuAppDisplayName(payload);
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
  let firstError: unknown;
  try {
    const name = await fetchFeishuAppDisplayName(bot, token, bot.feishuAppId);
    if (name?.trim()) {
      return name;
    }
  } catch (error) {
    firstError = error;
  }
  try {
    return await fetchFeishuAppDisplayName(bot, token, "me");
  } catch (error) {
    throw firstError ?? error;
  }
}

const FEISHU_USER_DISPLAY_NAME_TTL_MS = 10 * 60_000;
const feishuUserDisplayNames = new Map<string, { name: string | null; expiresAt: number }>();

export function resolveFeishuUserIdType(userId: string): "open_id" | "union_id" | "user_id" {
  if (userId.startsWith("ou_")) return "open_id";
  if (userId.startsWith("on_")) return "union_id";
  return "user_id";
}

/** 发布包 host `resolveFeishuUserDisplayName`。 */
export function resolveFeishuUserDisplayName(payload: Record<string, unknown>): string | null {
  const data = isRecord(payload.data) ? payload.data : null;
  const user = isRecord(data?.user) ? data.user : null;
  const name = typeof user?.name === "string" ? user.name.trim() : "";
  if (name) return name;
  const enName = typeof user?.en_name === "string" ? user.en_name.trim() : "";
  if (enName) return enName;
  const nickname = typeof user?.nickname === "string" ? user.nickname.trim() : "";
  return nickname || null;
}

/** 发布包 host `readFeishuUserDisplayName`：成功和空名字都缓存，失败不缓存。请求写在函数体内，单独的 fetchFeishuUserDisplayName 会多一个 keepName。 */
export async function readFeishuUserDisplayName(
  bot: BotConfigEntry,
  deps: BotCredentialLoader,
  providerUserId: string,
): Promise<string | null> {
  const userId = providerUserId.trim();
  if (!userId) return null;
  const cacheKey = `${getFeishuDomainProvider(bot)}:${bot.feishuAppId ?? ""}:${bot.credentialRef ?? ""}:${userId}`;
  const cached = feishuUserDisplayNames.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.name;
  }
  const token = await readTenantAccessToken(bot, deps);
  if (!token) return null;
  const userIdType = resolveFeishuUserIdType(userId);
  const result = await fetchBotProviderJson<Record<string, unknown>>(
    `${getFeishuBaseUrl(bot)}/open-apis/contact/v3/users/${encodeURIComponent(userId)}?user_id_type=${userIdType}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!result.ok) {
    throw new Error(`Feishu get user info failed user=${userId}: HTTP ${result.status}`);
  }
  const payload = result.payload ?? {};
  if (payload.code !== 0) {
    throw new Error(
      (typeof payload.msg === "string" ? payload.msg : "") ||
        `Feishu get user info failed user=${userId}.`,
    );
  }
  const name = resolveFeishuUserDisplayName(payload);
  feishuUserDisplayNames.set(cacheKey, {
    name,
    expiresAt: Date.now() + FEISHU_USER_DISPLAY_NAME_TTL_MS,
  });
  return name;
}

export function clearFeishuUserDisplayNameCache(): void {
  feishuUserDisplayNames.clear();
}

export type { BotProviderOutbound };

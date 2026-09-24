import type { BotConfigEntry } from "@zcode/shared";
import { fetchBotProviderJson } from "./botsHttp.js";
import { isRecord } from "./botsJson.js";
import type { BotCredentialLoader } from "./botsTypes.js";
import { getFeishuBaseUrl, getFeishuDomainProvider } from "./botsFeishuUrls.js";

const tenantTokens = new Map<string, { token: string; expiresAt: number }>();

/** 发布包 host `readTenantAccessToken`：缓存 90 分钟，提前 60 秒刷新。 */
export async function readTenantAccessToken(
  bot: BotConfigEntry,
  deps: BotCredentialLoader,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!bot.feishuAppId || !bot.credentialRef) {
    return null;
  }
  const secret = await deps.loadCredential(bot.credentialRef);
  if (!secret) {
    return null;
  }
  const key = `${getFeishuDomainProvider(bot)}:${bot.feishuAppId}:${bot.credentialRef}`;
  const cached = tenantTokens.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }
  const result = await fetchBotProviderJson<Record<string, unknown>>(
    `${getFeishuBaseUrl(bot)}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: bot.feishuAppId, app_secret: secret }),
      signal,
    },
  );
  if (!result.ok) {
    throw new Error(`Feishu tenant_access_token failed: HTTP ${result.status}`);
  }
  const payload = result.payload ?? {};
  if (payload.code !== 0 || typeof payload.tenant_access_token !== "string") {
    throw new Error((typeof payload.msg === "string" ? payload.msg : "") || "Feishu tenant_access_token failed.");
  }
  tenantTokens.set(key, {
    token: payload.tenant_access_token,
    expiresAt: Date.now() + 90 * 60_000,
  });
  return payload.tenant_access_token;
}

export function clearFeishuTenantTokenCache(): void {
  tenantTokens.clear();
}

export async function readFeishuAppSecret(
  bot: BotConfigEntry,
  deps: BotCredentialLoader,
): Promise<string | null> {
  return !bot.feishuAppId || !bot.credentialRef ? null : deps.loadCredential(bot.credentialRef);
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

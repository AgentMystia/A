import type { BotConfigEntry, BotProviderId } from "@zcode/shared";
import { isFeishuBotProvider } from "@zcode/shared";
import { FEISHU_OPEN_API, LARK_OPEN_API } from "./botsConstants.js";

export function getFeishuDomainProvider(bot: Pick<BotConfigEntry, "provider">): "feishu" | "lark" {
  return bot.provider === "lark" ? "lark" : "feishu";
}

export function getFeishuBaseUrl(bot: Pick<BotConfigEntry, "provider">): string {
  return getFeishuDomainProvider(bot) === "lark" ? LARK_OPEN_API : FEISHU_OPEN_API;
}

export function resolveFeishuReceiveIdType(receiveId: string): "chat_id" | "open_id" {
  return receiveId.startsWith("oc_") ? "chat_id" : "open_id";
}

export function isFeishuProvider(provider: BotProviderId): boolean {
  return isFeishuBotProvider(provider);
}

export function createFeishuMessageError(
  action: string,
  status: number,
  payload: { code?: number; msg?: string; error?: { log_id?: string } } | undefined,
  responseLogId?: string,
  receiveIdType?: string,
): Error {
  const details = [
    typeof payload?.code === "number" ? `code=${payload.code}` : null,
    payload?.msg ? `msg=${payload.msg}` : null,
    payload?.error?.log_id || responseLogId ? `log_id=${payload?.error?.log_id ?? responseLogId}` : null,
    receiveIdType ? `receive_id_type=${receiveIdType}` : null,
  ].filter(Boolean);
  return new Error(
    `Feishu ${action} failed: HTTP ${status}${details.length > 0 ? `, ${details.join(", ")}` : ""}`,
  );
}

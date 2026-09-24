import { Buffer } from "node:buffer";
import { randomInt, randomUUID } from "node:crypto";
import type { BotConfigEntry } from "@zcode/shared";
import {
  WEIXIN_API_BASE,
  WEIXIN_BOT_PATH,
  WEIXIN_CHANNEL_VERSION,
  WEIXIN_GET_UPDATES_TIMEOUT_MS,
} from "./botsConstants.js";
import { fetchBotProviderJson } from "./botsHttp.js";
import { isRecord, readNumber, readString, unwrapData } from "./botsJson.js";
import type { BotCredentialLoader } from "./botsTypes.js";

export function getWeixinApiBaseUrl(): string {
  return WEIXIN_API_BASE.replace(/\/+$/u, "");
}

export function buildWeixinClientId(): string {
  return `zcode-weixin-${randomUUID()}`;
}

function buildRandomWechatUin(): string {
  return Buffer.from(String(randomInt(0, 4_294_967_296)), "utf8").toString("base64");
}

// 发布包 host 的 keepName 是 readAccessToken / buildHeaders，不是带 Weixin 前缀的名字。
async function readAccessToken(
  bot: BotConfigEntry,
  deps: BotCredentialLoader,
): Promise<string | null> {
  return bot.credentialRef ? deps.loadCredential(bot.credentialRef) : null;
}

function buildHeaders(token: string): Record<string, string> {
  return {
    "content-type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${token}`,
    "X-WECHAT-UIN": buildRandomWechatUin(),
  };
}

function appendBaseInfo(body: unknown): unknown {
  return isRecord(body) ? { base_info: { channel_version: WEIXIN_CHANNEL_VERSION }, ...body } : body;
}

/** 发布包 host `requestWeixinJson`。 */
export async function requestWeixinJson(
  bot: BotConfigEntry,
  deps: BotCredentialLoader,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  timeoutMs = WEIXIN_GET_UPDATES_TIMEOUT_MS,
): Promise<unknown> {
  const token = await readAccessToken(bot, deps);
  if (!token?.trim()) {
    throw new Error("Weixin iLink bot token is missing. Scan the Weixin login QR code first.");
  }
  const result = await fetchBotProviderJson<Record<string, unknown>>(
    `${getWeixinApiBaseUrl()}${WEIXIN_BOT_PATH}${path}`,
    {
      method: "POST",
      headers: buildHeaders(token.trim()),
      body: JSON.stringify(appendBaseInfo(body ?? {})),
      signal,
    },
    timeoutMs,
  );
  if (!result.ok) {
    throw new Error(`Weixin iLink ${path} failed: HTTP ${result.status}`);
  }
  const payload = isRecord(result.payload) ? result.payload : null;
  const ret = readNumber(payload, "ret");
  const errcode = readNumber(payload, "errcode");
  if ((ret !== null && ret !== 0) || (errcode !== null && errcode !== 0)) {
    const message =
      readString(payload, "errmsg") ||
      readString(payload, "message") ||
      `ret=${ret ?? ""} errcode=${errcode ?? ""}`.trim();
    throw new Error(`Weixin iLink ${path} failed: ${message}`);
  }
  return result.payload;
}

export function readMessagesContainer(value: unknown): Record<string, unknown> {
  const data = unwrapData(value);
  return isRecord(data) ? data : {};
}

export function readWeixinMessages(value: unknown): Record<string, unknown>[] {
  const container = readMessagesContainer(value);
  const list = container.msgs ?? container.messages ?? container.updates ?? container.items ?? container.list;
  if (Array.isArray(list)) {
    return list.filter(isRecord);
  }
  return isRecord(list) ? [list] : [];
}

export function readNextBuf(value: unknown): string | undefined {
  const container = readMessagesContainer(value);
  return (
    readString(container, "get_updates_buf") ||
    readString(container, "buf") ||
    readString(container, "next_buf") ||
    readString(container, "nextBuf") ||
    readString(container, "getUpdatesBuf") ||
    readString(container, "syncKey") ||
    undefined
  );
}

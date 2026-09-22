import type { WeixinRegistrationBegin, WeixinRegistrationPoll } from "@zcode/shared";
import {
  WEIXIN_API_BASE,
  WEIXIN_BOT_PATH,
  WEIXIN_QR_EXPIRES_SECONDS,
  WEIXIN_QR_INTERVAL_SECONDS,
  WEIXIN_REGISTRATION_TIMEOUT_MS,
} from "./botsConstants.js";
import { isRecord, readNumber, readString } from "./botsJson.js";

function getWeixinRegistrationBaseUrl(): string {
  return WEIXIN_API_BASE.replace(/\/+$/u, "");
}

function unwrapRegistrationData(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  return isRecord(value.data) ? { ...value, ...value.data } : value;
}

async function getWeixinRegistrationJson(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${getWeixinRegistrationBaseUrl()}${WEIXIN_BOT_PATH}${path}`, {
    method: "GET",
    headers: { "iLink-App-ClientVersion": "1" },
    signal: AbortSignal.timeout(WEIXIN_REGISTRATION_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Weixin login ${path} failed: HTTP ${response.status}`);
  }
  const payload = unwrapRegistrationData(await response.json());
  const ret = readNumber(payload, "ret");
  const errcode = readNumber(payload, "errcode");
  if ((ret !== null && ret !== 0) || (errcode !== null && errcode !== 0)) {
    throw new Error(readString(payload, "errmsg") || `ret=${ret ?? ""} errcode=${errcode ?? ""}`.trim());
  }
  return payload;
}

/** 发布包 host `normalizeQrStatus`。 */
export function normalizeWeixinQrStatus(value: unknown): WeixinRegistrationPoll["status"] | "scanned" {
  if (typeof value === "number") {
    if (value === 0) {
      return "pending";
    }
    if (value === 1) {
      return "scanned";
    }
    if (value === 2) {
      return "success";
    }
    if (value === 3 || value === 4) {
      return "expired";
    }
  }
  if (typeof value !== "string") {
    return "pending";
  }
  const normalized = value.toLowerCase();
  if (["confirmed", "confirm", "authorized", "success", "ok"].includes(normalized)) {
    return "success";
  }
  if (["scaned", "scanned", "scan", "confirmed_wait"].includes(normalized)) {
    return "scanned";
  }
  if (["expired", "timeout", "cancel", "cancelled", "canceled"].includes(normalized)) {
    return "expired";
  }
  if (["error", "failed", "fail"].includes(normalized)) {
    return "error";
  }
  return "pending";
}

export async function beginWeixinRegistration(): Promise<WeixinRegistrationBegin> {
  const payload = await getWeixinRegistrationJson("/get_bot_qrcode?bot_type=3");
  const qrCode = readString(payload, "qrcode") || readString(payload, "qr_code");
  const qrUrl = readString(payload, "qrcode_img_content") || readString(payload, "qrcode_url") || qrCode;
  if (!qrCode || !qrUrl) {
    throw new Error("Weixin login did not return a QR code.");
  }
  const expiresIn = readNumber(payload, "expires_in") ?? WEIXIN_QR_EXPIRES_SECONDS;
  return {
    qrCode,
    qrUrl,
    interval: WEIXIN_QR_INTERVAL_SECONDS,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export async function pollWeixinRegistration(request: { qrCode: string }): Promise<WeixinRegistrationPoll> {
  let payload: Record<string, unknown>;
  try {
    payload = await getWeixinRegistrationJson(
      `/get_qrcode_status?qrcode=${encodeURIComponent(request.qrCode)}`,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return { status: "pending", interval: WEIXIN_QR_INTERVAL_SECONDS };
    }
    throw error;
  }
  const status = normalizeWeixinQrStatus(payload.status ?? payload.qrcode_status ?? payload.qr_status);
  if (status === "success") {
    const botToken = readString(payload, "bot_token") || readString(payload, "token");
    return botToken
      ? {
          status: "success",
          botToken,
          botId: readString(payload, "ilink_bot_id") || readString(payload, "bot_id") || undefined,
        }
      : { status: "error", message: "Weixin login succeeded but did not return bot_token." };
  }
  if (status === "expired") {
    return { status: "expired" };
  }
  if (status === "error") {
    return { status: "error", message: readString(payload, "errmsg") || "Weixin login failed." };
  }
  return { status, interval: WEIXIN_QR_INTERVAL_SECONDS };
}

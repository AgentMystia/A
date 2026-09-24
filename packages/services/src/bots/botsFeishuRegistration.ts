import type { FeishuRegistrationBegin, FeishuRegistrationPoll } from "@zcode/shared";
import {
  FEISHU_ACCOUNTS_FEISHU,
  FEISHU_ACCOUNTS_LARK,
  FEISHU_REGISTRATION_PATH,
  FEISHU_REGISTRATION_SOURCE,
} from "./botsConstants.js";
import { isRecord, readString } from "./botsJson.js";

export function getAccountsBaseUrl(domain: "feishu" | "lark"): string {
  return domain === "lark" ? FEISHU_ACCOUNTS_LARK : FEISHU_ACCOUNTS_FEISHU;
}

function readRegistrationAppName(payload: Record<string, unknown>): string | undefined {
  const app = isRecord(payload.app) ? payload.app : null;
  return (
    (typeof payload.app_name === "string" ? payload.app_name.trim() : "") ||
    (typeof payload.client_name === "string" ? payload.client_name.trim() : "") ||
    (typeof payload.name === "string" ? payload.name.trim() : "") ||
    readString(app, "app_name").trim() ||
    readString(app, "name").trim() ||
    undefined
  );
}

async function postRegistration(
  domain: "feishu" | "lark",
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${getAccountsBaseUrl(domain)}${FEISHU_REGISTRATION_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  return (await response.json()) as Record<string, unknown>;
}

/** 发布包 host `beginFeishuAppRegistration`。 */
export async function beginFeishuAppRegistration(
  domain: "feishu" | "lark" = "feishu",
): Promise<FeishuRegistrationBegin> {
  const pollDomain = "feishu";
  const init = await postRegistration(pollDomain, { action: "init" });
  const methods = Array.isArray(init.supported_auth_methods) ? init.supported_auth_methods : [];
  if (!methods.includes("client_secret")) {
    throw new Error("Current Feishu environment does not support client_secret registration.");
  }
  const begin = await postRegistration(pollDomain, {
    action: "begin",
    archetype: "PersonalAgent",
    auth_method: "client_secret",
    request_user_info: "open_id",
  });
  const deviceCode = typeof begin.device_code === "string" ? begin.device_code : "";
  const verification = typeof begin.verification_uri_complete === "string" ? begin.verification_uri_complete : "";
  if (!deviceCode || !verification) {
    throw new Error("Feishu app registration did not return a device code.");
  }
  const qrUrl = new URL(verification);
  qrUrl.searchParams.set("from", "sdk");
  qrUrl.searchParams.set("source", FEISHU_REGISTRATION_SOURCE);
  qrUrl.searchParams.set("tp", "sdk");
  const expireIn = typeof begin.expire_in === "number" ? begin.expire_in : 600;
  return {
    deviceCode,
    qrUrl: qrUrl.toString(),
    userCode: typeof begin.user_code === "string" ? begin.user_code : "",
    interval: typeof begin.interval === "number" ? begin.interval : 5,
    expiresAt: Date.now() + expireIn * 1000,
    domain,
    pollDomain,
  };
}

export async function pollFeishuAppRegistration(request: {
  deviceCode: string;
  domain?: "feishu" | "lark";
  pollDomain?: "feishu" | "lark";
}): Promise<FeishuRegistrationPoll> {
  const domain = request.domain ?? "feishu";
  const pollDomain = request.pollDomain ?? domain;
  const payload = await postRegistration(pollDomain, { action: "poll", device_code: request.deviceCode });
  const userInfo = isRecord(payload.user_info) ? payload.user_info : null;
  const tenantBrand = typeof userInfo?.tenant_brand === "string" ? userInfo.tenant_brand : pollDomain;
  if (userInfo?.tenant_brand === "lark" && pollDomain !== "lark") {
    return { status: "pending", interval: 0, domain: tenantBrand, pollDomain: "lark" };
  }
  const clientId = typeof payload.client_id === "string" ? payload.client_id : "";
  const clientSecret = typeof payload.client_secret === "string" ? payload.client_secret : "";
  if (clientId && clientSecret) {
    const appName = readRegistrationAppName(payload);
    return {
      status: "success",
      appId: clientId,
      appSecret: clientSecret,
      domain: tenantBrand,
      ...(appName ? { appName } : {}),
      openId: typeof userInfo?.open_id === "string" ? userInfo.open_id : undefined,
    };
  }
  const error = typeof payload.error === "string" ? payload.error : "";
  if (!error || error === "authorization_pending") {
    return { status: "pending", interval: 5, domain: tenantBrand };
  }
  if (error === "slow_down") {
    return { status: "pending", interval: 10, domain: tenantBrand };
  }
  if (error === "access_denied") {
    return { status: "access_denied", domain: tenantBrand };
  }
  if (error === "expired_token") {
    return { status: "expired", domain: tenantBrand };
  }
  return {
    status: "error",
    message: `${error}: ${typeof payload.error_description === "string" ? payload.error_description : "unknown"}`,
    domain: tenantBrand,
  };
}

const CAPTCHA_NETWORK_REQUEST_TTL_MS = 300_000;
const CAPTCHA_NETWORK_REQUEST_LIMIT = 128;
const CAPTCHA_NETWORK_ERROR_CODE = /^net::ERR_[A-Z_]+$/;
const CAPTCHA_INIT_HOST = /^(?:[a-z0-9-]+\.)?captcha-(?:pro-)?open(?:-[a-z0-9-]+)?\.aliyuncs\.com$/;
const CAPTCHA_IMAGE_HOST = /^static-captcha(?:-[a-z0-9-]+)?\.aliyuncs\.com$/;
const CAPTCHA_CDN_HOSTS = new Set(["o.alicdn.com", "g.alicdn.com", "x.alicdn.com"]);
const CAPTCHA_DEVICE_API_HOSTS = new Set([
  "cloudauth-device-pre.aliyuncs.com",
  "cloudauth-device-pre.ap-southeast-1.aliyuncs.com",
  "cloudauth-device-dualstack.cn-shanghai.aliyuncs.com",
  "cloudauth-device-dualstack.ap-southeast-1.aliyuncs.com",
  "cn-shanghai.device.saf.aliyuncs.com",
  "ap-southeast-1.device.saf.aliyuncs.com",
  "ap-southeast-1-ga.device.saf.aliyuncs.com",
  "pre-cn-shanghai.device.saf.aliyuncs.com",
  "pre-ap-southeast-1.device.saf.aliyuncs.com",
]);

export const CAPTCHA_NETWORK_URL_FILTER = {
  urls: ["https://*.alicdn.com/*", "https://*.aliyuncs.com/*"],
};

export type CaptchaNetworkResourceKind =
  | "device_api"
  | "sdk_log"
  | "init_api"
  | "image"
  | "sdk_script"
  | "dynamic_css"
  | "dynamic_js"
  | "device_script";

export interface CaptchaNetworkResource {
  kind: CaptchaNetworkResourceKind;
  host: string;
  path: string;
}

export interface CaptchaNetworkRequestDetails {
  id: number;
  url: string;
  webContentsId?: number;
  statusCode?: number;
  error?: string;
}

export interface CaptchaNetworkWebRequest {
  onBeforeRequest(
    filter: { urls: string[] },
    listener: (
      details: CaptchaNetworkRequestDetails,
      callback: (response: Record<string, never>) => void,
    ) => void,
  ): void;
  onCompleted(
    filter: { urls: string[] },
    listener: (details: CaptchaNetworkRequestDetails) => void,
  ): void;
  onErrorOccurred(
    filter: { urls: string[] },
    listener: (details: CaptchaNetworkRequestDetails) => void,
  ): void;
}

/** 发布包 `resource`。未命中的阿里云地址不记日志，也不改写 URL。 */
export function classifyCaptchaNetworkResource(url: string): CaptchaNetworkResource | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname;
  if (CAPTCHA_DEVICE_API_HOSTS.has(host)) {
    return { kind: "device_api", host, path: "/" };
  }
  if (CAPTCHA_INIT_HOST.test(host)) {
    return {
      kind: host.startsWith("upload.") ? "sdk_log" : "init_api",
      host: host.replace(/^[^.]+\.(?=captcha-)/, "[prefix]."),
      path: "/",
    };
  }
  if (CAPTCHA_IMAGE_HOST.test(host)) {
    return { kind: "image", host, path: "/[image]" };
  }
  if (CAPTCHA_CDN_HOSTS.has(host) && parsed.pathname.startsWith("/captcha-frontend/")) {
    const kind = parsed.pathname.endsWith("/AliyunCaptcha.js")
      ? "sdk_script"
      : parsed.pathname.includes("/dynamicJS/")
        ? parsed.pathname.endsWith(".css")
          ? "dynamic_css"
          : "dynamic_js"
        : "device_script";
    return {
      kind,
      host,
      path:
        kind === "sdk_script"
          ? "/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js"
          : `/captcha-frontend/[${kind}]`,
    };
  }
  return undefined;
}

function pruneCaptchaNetworkRequests(startedAtByRequestId: Map<number, number>, now: number): void {
  for (const [requestId, startedAt] of startedAtByRequestId) {
    if (now - startedAt > CAPTCHA_NETWORK_REQUEST_TTL_MS) {
      startedAtByRequestId.delete(requestId);
    }
  }
  if (startedAtByRequestId.size >= CAPTCHA_NETWORK_REQUEST_LIMIT) {
    const oldest = startedAtByRequestId.keys().next().value;
    if (oldest !== undefined) startedAtByRequestId.delete(oldest);
  }
}

/**
 * 发布包 `installCaptchaNetworkDiagnostics`。
 * 过滤命中后仍要立刻 callback，否则非验证码的 alicdn 请求会被 webRequest 挂起。
 */
export function installCaptchaNetworkDiagnostics(
  webRequest: CaptchaNetworkWebRequest,
  logger: { info: (...args: unknown[]) => void },
): void {
  const startedAtByRequestId = new Map<number, number>();
  webRequest.onBeforeRequest(CAPTCHA_NETWORK_URL_FILTER, (details, callback) => {
    // 诊断不能取消或改写请求。
    callback({});
    const resource = classifyCaptchaNetworkResource(details.url);
    if (!resource) return;
    const now = Date.now();
    pruneCaptchaNetworkRequests(startedAtByRequestId, now);
    startedAtByRequestId.set(details.id, now);
    logger.info("[captcha-network]", {
      event: "resource.start",
      networkRequestId: details.id,
      webContentsId: details.webContentsId,
      ...resource,
    });
  });
  const finish = (details: CaptchaNetworkRequestDetails) => {
    const startedAt = startedAtByRequestId.get(details.id);
    startedAtByRequestId.delete(details.id);
    const resource = classifyCaptchaNetworkResource(details.url);
    if (!resource) return;
    const now = Date.now();
    pruneCaptchaNetworkRequests(startedAtByRequestId, now);
    logger.info("[captcha-network]", {
      event: details.error ? "resource.failed" : "resource.completed",
      networkRequestId: details.id,
      webContentsId: details.webContentsId,
      ...resource,
      elapsedMs: startedAt === undefined ? null : now - startedAt,
      statusCode: details.statusCode ?? null,
      errorCode:
        details.error && CAPTCHA_NETWORK_ERROR_CODE.test(details.error) ? details.error : null,
    });
  };
  webRequest.onCompleted(CAPTCHA_NETWORK_URL_FILTER, finish);
  webRequest.onErrorOccurred(CAPTCHA_NETWORK_URL_FILTER, finish);
}

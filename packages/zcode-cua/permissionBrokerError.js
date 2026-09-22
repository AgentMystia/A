/** 发布包 host `ur`。可重试的传输失败都用这个 code。 */
export const BROKER_UNAVAILABLE = "broker_unavailable";

const HOLD_RESPONSE_SLACK_MS = 5_000;
const MAX_HOLD_SECONDS = 30;

/**
 * 发布包 host `legacyHelperMessageProvesActionNotSent`。
 * 旧 Helper 用这些句子表示动作没有发出；新错误对象要补上 `action_sent=false`。
 */
export function legacyHelperMessageProvesActionNotSent(message) {
  return (
    /\braw foreground event\b.*\brefused because\b/i.test(message) ||
    /\bmodifiers must be a '\+'-separated chord\b/i.test(message) ||
    /\belement \([^)]*\) is not settable; refuse set_value\b/i.test(message) ||
    /\belement \([^)]*\) is not selectable; refuse select_text\b/i.test(message)
  );
}

export class PermissionBrokerError extends Error {
  constructor(message = "unknown broker error", options = {}) {
    const resolved =
      (message && message.length > 0
        ? message
        : options.code && options.code.length > 0
          ? options.code
          : "unknown broker error") || "unknown broker error";
    const text =
      (options.details?.action_sent === false ||
        legacyHelperMessageProvesActionNotSent(resolved)) &&
      !/\baction_sent\s*=\s*false\b/i.test(resolved)
        ? `${resolved.replace(/\s+$/u, "")} action_sent=false.`
        : resolved;
    super(text, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "PermissionBrokerError";
    this.code =
      typeof options.code === "string" && options.code.trim().length > 0
        ? options.code.trim()
        : null;
    this.details = options.details ? { ...options.details } : {};
    this.permissionError = options.permissionError === true;
  }
}

export function permissionBrokerPermissionError(message, options = {}) {
  return new PermissionBrokerError(message, { ...options, permissionError: true });
}

/** 发布包 host `boundedHoldDuration`。duration 按秒计，上限 30 秒。 */
export function boundedHoldDuration(method, params) {
  if (method !== "hold_key" && method !== "hold_key_to_app") return 0;
  const duration = (params ?? {}).duration;
  if (
    typeof duration === "boolean" ||
    typeof duration !== "number" ||
    !Number.isFinite(duration) ||
    duration < 0
  ) {
    return 0;
  }
  return Math.min(duration, MAX_HOLD_SECONDS) * 1_000;
}

/** 发布包 host `businessResponseTimeout`。按住类调用要覆盖按住时长再加 5 秒。 */
export function businessResponseTimeout(timeoutMs, method, params) {
  if (method !== "hold_key" && method !== "hold_key_to_app") return timeoutMs;
  const holdMs = boundedHoldDuration(method, params);
  return holdMs <= 0 ? timeoutMs : Math.max(timeoutMs, holdMs + HOLD_RESPONSE_SLACK_MS);
}

export function isValidErrorEnvelope(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value.message;
  const code = value.code;
  const details = value.details;
  const invalid =
    (message !== undefined && (typeof message !== "string" || message.trim().length === 0)) ||
    (code !== undefined && (typeof code !== "string" || code.trim().length === 0)) ||
    (details !== undefined &&
      (details === null || typeof details !== "object" || Array.isArray(details)));
  if (invalid) return false;
  return (
    (typeof message === "string" && message.trim().length > 0) ||
    (typeof code === "string" && code.trim().length > 0)
  );
}

export function parseErrorPayload(value) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const code =
      typeof value.code === "string" && value.code.trim().length > 0 ? value.code.trim() : null;
    const message =
      (typeof value.message === "string" && value.message.trim().length > 0
        ? String(value.message)
        : null) ??
      code ??
      "unknown broker error";
    const details =
      value.details !== null && typeof value.details === "object" && !Array.isArray(value.details)
        ? { ...value.details }
        : {};
    return { message: String(message), code, details };
  }
  return { message: String(value ?? "unknown broker error"), code: null, details: {} };
}

export function extractAuthErrorMessage(response) {
  const error = response.error;
  if (error !== null && typeof error === "object" && !Array.isArray(error)) {
    const message = error.message;
    if (typeof message === "string" && message.trim().length > 0) return message;
  }
  return "auth rejected";
}

export function cancelledBrokerError() {
  return new PermissionBrokerError(
    "ZCode permission broker RPC was cancelled before the next socket transition",
    {
      code: BROKER_UNAVAILABLE,
      details: { rpc_deadline_state: "cancelled", request_delivery_state: "not_sent" },
    },
  );
}

export function wrapTransportError(error, sanitize, deliveryState, errorType) {
  const message = error instanceof Error ? error.message : String(error ?? "transport error");
  const type =
    errorType ??
    (error instanceof Error ? error.name : typeof error === "string" ? "string" : "unknown");
  return new PermissionBrokerError(sanitize(`ZCode permission broker is unavailable: ${message}`), {
    code: BROKER_UNAVAILABLE,
    details: { error_type: type, request_delivery_state: deliveryState },
  });
}

export function wrapPeerCheckError(error, deliveryState) {
  if (error instanceof PermissionBrokerError) {
    if (error.code === BROKER_UNAVAILABLE) {
      return new PermissionBrokerError(error.message, {
        code: error.code,
        details: { ...error.details, request_delivery_state: deliveryState },
        permissionError: error.permissionError,
      });
    }
    return error;
  }
  return new PermissionBrokerError(`peer credential check raised unexpectedly: ${String(error)}`, {
    code: BROKER_UNAVAILABLE,
    details: { request_delivery_state: deliveryState },
  });
}

export function invalidResponseError(message, responseState) {
  return new PermissionBrokerError(message, {
    code: BROKER_UNAVAILABLE,
    details: { broker_response_state: responseState, request_delivery_state: "possibly_sent" },
  });
}

export function brokerUnavailableFromTransport(message, deliveryState, errorType) {
  return new PermissionBrokerError(message, {
    code: BROKER_UNAVAILABLE,
    details: { error_type: errorType, request_delivery_state: deliveryState },
  });
}

/** 发布包 host `mismatchError`。PiP 握手不一致后客户端停用。 */
export function mismatchError(message) {
  return new PermissionBrokerError(message, { code: "version_mismatch" });
}

export class CaptchaInteractiveRequiredError extends Error {
  readonly code = "CAPTCHA_INTERACTIVE_REQUIRED";

  constructor(message = "Captcha requires interactive verification.") {
    super(message);
    this.name = "CaptchaInteractiveRequiredError";
  }
}

export interface CaptchaOutcome {
  success?: boolean;
  verifyResult?: boolean;
  verifyCode?: string;
  certifyId?: string;
}

export interface CaptchaFailSummary {
  verifyCode: string | null;
  success: boolean | null;
  verifyResult: boolean | null;
  certifyId: string | null;
  awaitingUpgrade: boolean;
  terminalPass: boolean;
  hasParamInFail: boolean;
  duplicateSubmission: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readCaptchaOutcome(value: unknown): CaptchaOutcome | null {
  if (!isRecord(value)) return null;
  const verifyCode =
    typeof value.verifyCode === "string"
      ? value.verifyCode
      : typeof value.VerifyCode === "string"
        ? value.VerifyCode
        : undefined;
  return {
    success: typeof value.success === "boolean" ? value.success : undefined,
    verifyResult: typeof value.verifyResult === "boolean" ? value.verifyResult : undefined,
    verifyCode,
    certifyId: typeof value.certifyId === "string" ? value.certifyId : undefined,
  };
}

export function isDuplicateCaptchaSubmission(value: unknown): boolean {
  if (readCaptchaOutcome(value)?.verifyCode !== "F008") return false;
  const text = typeof value === "string" ? value : isRecord(value) ? JSON.stringify(value) : "";
  return text.includes("重复提交") || text.includes("只允许提交一次");
}

export function readCertifyIdFromVerifyParam(param: string | undefined): string | undefined {
  const trimmed = param?.trim();
  if (!trimmed?.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as { certifyId?: unknown };
    return typeof parsed.certifyId === "string" ? parsed.certifyId : undefined;
  } catch {
    return undefined;
  }
}

export function readCaptchaVerifyParam(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const param =
    typeof value.captchaVerifyParam === "string"
      ? value.captchaVerifyParam
      : typeof value.CaptchaVerifyParam === "string"
        ? value.CaptchaVerifyParam
        : undefined;
  return param?.trim() || undefined;
}

export function isCaptchaTerminalPass(value: unknown): boolean {
  const outcome = readCaptchaOutcome(value);
  if (!outcome) return false;
  return (
    (outcome.success === true && outcome.verifyResult === true) || outcome.verifyCode === "T006"
  );
}

export function isCaptchaUpgradeRequired(value: unknown): boolean {
  const outcome = readCaptchaOutcome(value);
  return outcome ? outcome.success === true && outcome.verifyResult === false : false;
}

/** 无痕未通过，或已经终态通过但 fail 回调里没有 verify param。 */
export function isCaptchaInteractiveRequired(value: unknown): boolean {
  if (isCaptchaUpgradeRequired(value)) return true;
  return isCaptchaTerminalPass(value) && readCaptchaVerifyParam(value) === undefined;
}

export function readCaptchaFailSummary(value: unknown): CaptchaFailSummary {
  const outcome = readCaptchaOutcome(value);
  return {
    verifyCode: outcome?.verifyCode ?? null,
    success: outcome?.success ?? null,
    verifyResult: outcome?.verifyResult ?? null,
    certifyId: outcome?.certifyId ?? null,
    awaitingUpgrade: isCaptchaUpgradeRequired(value),
    terminalPass: isCaptchaTerminalPass(value),
    hasParamInFail: Boolean(readCaptchaVerifyParam(value)),
    duplicateSubmission: isDuplicateCaptchaSubmission(value),
  };
}

function readNamedString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function readNamedNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function readCaptchaSdkError(value: unknown): CaptchaFailSummary & {
  aliyunErrorCode: string | null;
  aliyunErrorMessage: string | null;
  requestId: string | null;
  hostId: string | null;
  statusCode: number | null;
  errorName: string | null;
} {
  const summary = readCaptchaFailSummary(value);
  if (isRecord(value)) {
    return {
      ...summary,
      aliyunErrorCode: readNamedString(value, ["Code", "code", "errorCode", "ErrorCode"]),
      aliyunErrorMessage: readNamedString(value, [
        "Message",
        "message",
        "errorMessage",
        "ErrorMessage",
        "msg",
      ]),
      requestId: readNamedString(value, ["RequestId", "requestId", "requestID"]),
      hostId: readNamedString(value, ["HostId", "hostId"]),
      statusCode: readNamedNumber(value, ["StatusCode", "statusCode", "status"]),
      errorName: value instanceof Error ? value.name : null,
    };
  }
  return {
    ...summary,
    aliyunErrorCode: null,
    aliyunErrorMessage: value instanceof Error ? value.message : String(value),
    requestId: null,
    hostId: null,
    statusCode: null,
    errorName: value instanceof Error ? value.name : null,
  };
}

export function classifyCaptchaFailureKind(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Captcha instance timed out after ")) return "instance_timeout";
  if (message === "Failed to load captcha script.") return "script_load_failed";
  if (message.startsWith("Captcha verification timed out after ")) return "verification_timeout";
  if (message.startsWith("Traceless captcha timed out after ")) return "traceless_timeout";
  return "unknown";
}

const CAPTCHA_SDK_CODE = /^(?:INIT_FAIL|DYNAMICJS_FAIL|DEVICE_INIT_FAIL|LIMIT_FLOW|[FT]\d{3})$/;

export function readCaptchaSdkCode(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const code = value.code ?? value.verifyCode;
  return typeof code === "string" && CAPTCHA_SDK_CODE.test(code) ? code : undefined;
}

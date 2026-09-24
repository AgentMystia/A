import { logger } from "@/logger.js";

import { classifyCaptchaFailureKind, readCaptchaSdkCode } from "./captchaResult.js";

export interface CaptchaDiagnosticContext {
  requestId?: string;
  providerId?: string;
  source?: string;
}

export interface CaptchaDiagnostics {
  readonly id: string;
  event(name: string, fields?: Record<string, unknown>, force?: boolean): void;
  stage(name: string): void;
  callback(
    name: string,
    accepted: boolean,
    currentControllerId: string | undefined,
    error?: unknown,
  ): void;
  snapshot(): { instanceReady: boolean; lastSdkEvent: string | undefined };
  end(outcome: string, error?: unknown, fields?: Record<string, unknown>): void;
}

export function createCaptchaDiagnostics(
  context: CaptchaDiagnosticContext = {},
): CaptchaDiagnostics {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const startedAt = Date.now();
  let stage = "start";
  let lastSdkEvent: string | undefined;
  let instanceReady = false;
  let count = 0;
  const event = (name: string, fields: Record<string, unknown> = {}, force = false): void => {
    // 强制收尾不占用 32 条配额；普通事件超过配额后丢弃。
    if (!force && count++ >= 32) return;
    logger.lifecycle.info("[captcha-diagnostics]", {
      event: name,
      attemptId: id,
      requestId: context.requestId,
      providerId: context.providerId,
      source: context.source,
      elapsedMs: Date.now() - startedAt,
      stage,
      instanceReady,
      lastSdkEvent,
      ...fields,
    });
  };
  event("attempt.start");
  return {
    id,
    event,
    stage(name) {
      stage = name;
      event("attempt.stage");
    },
    callback(name, accepted, currentControllerId, error) {
      lastSdkEvent = name;
      if (name === "getInstance" && accepted) instanceReady = true;
      event("sdk.callback", {
        controllerId: id,
        currentControllerId,
        callback: name,
        accepted,
        sdkCode: readCaptchaSdkCode(error),
      });
    },
    snapshot() {
      return { instanceReady, lastSdkEvent };
    },
    end(outcome, error, fields = {}) {
      event(
        "attempt.end",
        {
          outcome,
          ...(error ? { errorKind: classifyCaptchaFailureKind(error) } : {}),
          ...fields,
        },
        true,
      );
    },
  };
}

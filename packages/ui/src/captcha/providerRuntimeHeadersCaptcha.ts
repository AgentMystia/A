import type {
  ZCodeProviderRuntimeHeadersCancelled,
  ZCodeProviderRuntimeHeadersRequestParams,
} from "@zcode/shared";
import type {
  ICodingPlanSubscriptionService,
  IProviderSettingsService,
  IZCodeAgentService,
} from "@zcode/services";
import { logger } from "@/logger.js";

import { resolveStartPlanCaptchaHeaders } from "./aliyunCaptchaVerification.js";
import { isStartPlanCaptchaAccess, type CaptchaAccessConfig } from "./captchaConfig.js";
import { abortable } from "./captchaDom.js";
import { classifyCaptchaFailureKind } from "./captchaResult.js";
import { captchaRuntime } from "./captchaRuntimeState.js";

export function providerRuntimeHeadersRequestKey(event: {
  workspace: { workspaceIdentity?: string; workspacePath: string };
  sessionId: string;
  requestId: string;
}): string {
  return [
    event.workspace.workspaceIdentity?.trim() || event.workspace.workspacePath,
    event.sessionId,
    event.requestId,
  ].join("::");
}

async function readProviderAccess(
  providerSettingsService: Pick<IProviderSettingsService, "getView">,
  providerId: string,
): Promise<CaptchaAccessConfig | undefined> {
  const view = await providerSettingsService.getView();
  const config = view.providers.find(
    (provider) => provider.providerId === providerId,
  )?.effectiveConfig;
  if (!config) return undefined;
  return { access: config.access };
}

export async function refreshProviderRuntimeHeaders(input: {
  request: ZCodeProviderRuntimeHeadersRequestParams;
  zcodeSessionService: Pick<IZCodeAgentService, "respondProviderRuntimeHeaders">;
  codingPlanSubscriptionService: Pick<ICodingPlanSubscriptionService, "getCaptchaConfig">;
  providerSettingsService: Pick<IProviderSettingsService, "getView">;
  signal: AbortSignal;
}): Promise<void> {
  const request = input.request;
  logger.lifecycle.info("[captcha-diagnostics]", {
    event: "request.received",
    requestId: request.requestId,
    providerId: request.providerId,
    source: request.reason,
  });
  let errorKind: string | undefined;
  let errorMessage: string | undefined;
  let headers: Record<string, string> | undefined;
  try {
    const providerConfig = request.accountAccess
      ? { access: request.accountAccess }
      : await abortable(
          readProviderAccess(input.providerSettingsService, request.providerId),
          input.signal,
        );
    input.signal.throwIfAborted();
    if (isStartPlanCaptchaAccess(providerConfig)) {
      const reason: string = request.reason;
      const refreshed = await resolveStartPlanCaptchaHeaders({
        requestId: request.requestId,
        providerId: request.providerId,
        providerConfig,
        service: input.codingPlanSubscriptionService,
        source: reason === "captcha-retry" ? "captcha_retry" : "send_preflight",
        signal: input.signal,
      });
      headers = refreshed?.headers;
    }
  } catch (error) {
    if (input.signal.aborted) {
      logger.lifecycle.info("[captcha-diagnostics]", {
        event: "request.cancelled",
        requestId: request.requestId,
      });
      return;
    }
    errorKind = classifyCaptchaFailureKind(error);
    errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("[captcha] provider runtime headers refresh failed", {
      providerId: request.providerId,
      requestId: request.requestId,
      error: errorMessage,
    });
  }
  if (input.signal.aborted) return;
  logger.lifecycle.info("[captcha-diagnostics]", {
    event: "request.respond",
    requestId: request.requestId,
    headersApplied: Boolean(headers),
    errorKind,
  });
  await input.zcodeSessionService.respondProviderRuntimeHeaders({
    workspacePath: request.workspace.workspacePath,
    ...(request.workspace.workspaceIdentity
      ? { workspaceIdentity: request.workspace.workspaceIdentity }
      : {}),
    sessionId: request.sessionId,
    requestId: request.requestId,
    response: headers
      ? { headersApplied: true, runtimeProviderHeaders: headers }
      : { headersApplied: false, ...(errorMessage ? { errorMessage } : {}) },
  });
}

export async function handleProviderRuntimeHeadersRequest(input: {
  request: ZCodeProviderRuntimeHeadersRequestParams;
  zcodeSessionService: Pick<IZCodeAgentService, "respondProviderRuntimeHeaders">;
  codingPlanSubscriptionService: Pick<ICodingPlanSubscriptionService, "getCaptchaConfig">;
  providerSettingsService: Pick<IProviderSettingsService, "getView">;
}): Promise<void> {
  const key = providerRuntimeHeadersRequestKey(input.request);
  const existing = captchaRuntime.headerRequests.get(key);
  if (existing) {
    logger.info("[captcha] provider runtime headers request coalesced", {
      providerId: input.request.providerId,
      requestId: input.request.requestId,
      sessionId: input.request.sessionId,
    });
    try {
      await existing.promise;
    } catch (error) {
      logger.warn("[captcha] provider runtime headers coalesced response failed", {
        error: error instanceof Error ? error.message : String(error),
        providerId: input.request.providerId,
        requestId: input.request.requestId,
        sessionId: input.request.sessionId,
      });
    }
    return;
  }
  const controller = new AbortController();
  const promise = refreshProviderRuntimeHeaders({ ...input, signal: controller.signal }).finally(
    () => {
      captchaRuntime.headerRequests.delete(key);
    },
  );
  captchaRuntime.headerRequests.set(key, { promise, controller });
  try {
    await promise;
  } catch (error) {
    logger.warn("[captcha] provider runtime headers response failed", {
      error: error instanceof Error ? error.message : String(error),
      providerId: input.request.providerId,
      requestId: input.request.requestId,
      sessionId: input.request.sessionId,
    });
  }
}

export function cancelProviderRuntimeHeadersRequest(
  event: ZCodeProviderRuntimeHeadersCancelled,
): void {
  const pending = captchaRuntime.headerRequests.get(providerRuntimeHeadersRequestKey(event));
  if (!pending || pending.controller.signal.aborted) return;
  logger.info("[captcha] provider runtime headers cancelled", {
    requestId: event.requestId,
    sessionId: event.sessionId,
  });
  pending.controller.abort(new DOMException("Captcha request cancelled", "AbortError"));
}

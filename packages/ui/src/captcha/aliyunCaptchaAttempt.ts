import { logger } from "@/logger.js";

import {
  CAPTCHA_INSTANCE_WAIT_MS,
  CAPTCHA_PREWARM_DELAY_MS,
  CAPTCHA_TRACELESS_FALLBACK_MS,
  abortable,
} from "./captchaDom.js";
import { createCaptchaDiagnostics, type CaptchaDiagnosticContext } from "./captchaDiagnostics.js";
import { CaptchaInteractiveRequiredError, readCaptchaFailSummary } from "./captchaResult.js";
import {
  bindCaptchaController,
  rejectCaptchaSession,
  resetCaptchaController,
  type AliyunCaptchaRunConfig,
} from "./aliyunCaptchaSdk.js";
import {
  captchaRuntime,
  type AliyunCaptchaInstance,
  type CaptchaController,
  type CaptchaSession,
} from "./captchaRuntimeState.js";

export interface CaptchaAttemptOptions {
  diagnosticContext?: CaptchaDiagnosticContext;
  signal?: AbortSignal;
  allowInteractive?: boolean;
  preferInteractive?: boolean;
  timeoutMs?: number;
  onInteractiveChallenge?: () => void;
}

function debugCaptcha(event: string, payload: unknown): void {
  logger.debug("[captcha]", event, payload);
}

async function waitForCaptchaInstance(
  instancePromise: Promise<AliyunCaptchaInstance>,
  options: { configKey?: string; initStartedAt?: number; signal?: AbortSignal },
): Promise<AliyunCaptchaInstance> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      logger.warn("[captcha] aliyun sdk instance wait timed out", {
        configKey: options.configKey ?? null,
        timeoutMs: CAPTCHA_INSTANCE_WAIT_MS,
        elapsedSinceInitMs:
          options.initStartedAt === undefined ? null : Date.now() - options.initStartedAt,
      });
      reject(new Error(`Captcha instance timed out after ${CAPTCHA_INSTANCE_WAIT_MS}ms.`));
    }, CAPTCHA_INSTANCE_WAIT_MS);
    abortable(instancePromise, options.signal).then(
      (instance) => {
        window.clearTimeout(timer);
        resolve(instance);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function waitForCaptchaScriptSettle(): Promise<void> {
  if (!captchaRuntime.scriptLoadedAt) return;
  const elapsed = Date.now() - captchaRuntime.scriptLoadedAt;
  if (elapsed >= CAPTCHA_PREWARM_DELAY_MS) return;
  const delay = CAPTCHA_PREWARM_DELAY_MS - elapsed;
  await new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), delay);
  });
}

export async function prewarmAliyunCaptchaController(
  config: AliyunCaptchaRunConfig,
): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const diagnostics = createCaptchaDiagnostics({ source: "prewarm" });
  try {
    await bindCaptchaController(config, diagnostics);
    diagnostics.end("init_dispatched");
  } catch (error) {
    diagnostics.end("error", error);
    throw error;
  }
}

function executeCaptchaInstance(input: {
  instance: AliyunCaptchaInstance;
  controller: CaptchaController;
  session: CaptchaSession;
  allowInteractive: boolean;
  preferInteractive: boolean;
  attemptKind: string;
  timeoutMs?: number;
  onInteractiveChallenge?: () => void;
  requestInteractive: (error: unknown) => void;
  armTracelessTimer: (callback: () => void) => void;
}): void {
  const { instance, controller } = input;
  logger.info("[captcha] aliyun execute start", {
    allowInteractive: input.allowInteractive,
    attemptKind: input.attemptKind,
    hasShow: typeof instance.show === "function",
    hasStartTracelessVerification: typeof instance.startTracelessVerification === "function",
    preferInteractive: input.preferInteractive,
    timeoutMs: input.timeoutMs ?? null,
  });
  if (!input.preferInteractive && typeof instance.startTracelessVerification === "function") {
    logger.info("[captcha] aliyun start traceless verification", {
      attemptKind: input.attemptKind,
    });
    instance.startTracelessVerification();
    if (input.allowInteractive) {
      input.armTracelessTimer(() => {
        if (!captchaRuntime.session || captchaRuntime.session !== input.session) return;
        input.requestInteractive(
          new CaptchaInteractiveRequiredError(
            `Traceless captcha did not respond after ${CAPTCHA_TRACELESS_FALLBACK_MS}ms.`,
          ),
        );
      });
    }
    return;
  }
  if (!input.allowInteractive) {
    rejectCaptchaSession(
      new CaptchaInteractiveRequiredError(
        "Traceless verification is unavailable for this captcha instance.",
      ),
    );
    return;
  }
  if (input.preferInteractive) {
    input.onInteractiveChallenge?.();
    logger.info("[captcha] aliyun trigger button click", {
      attemptKind: input.attemptKind,
      buttonSelector: controller.buttonSelector,
    });
    controller.buttonElement.click();
    return;
  }
  logger.info("[captcha] aliyun fallback button click", {
    attemptKind: input.attemptKind,
    buttonSelector: controller.buttonSelector,
  });
  input.onInteractiveChallenge?.();
  controller.buttonElement.click();
}

export async function runCaptchaAttempt(
  config: AliyunCaptchaRunConfig,
  options: CaptchaAttemptOptions = {},
): Promise<string> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Captcha requires browser environment.");
  }
  if (captchaRuntime.session || captchaRuntime.busy) {
    throw new Error("Captcha verification is already in progress.");
  }
  options.signal?.throwIfAborted();
  captchaRuntime.busy = true;
  const diagnostics = createCaptchaDiagnostics(options.diagnosticContext);
  let failure: unknown;
  let outcome = "success";
  const signal = options.signal;
  let controller: CaptchaController | undefined;
  let session: CaptchaSession | null = null;
  const onAbort = () => {
    if (!controller || captchaRuntime.controller !== controller) return;
    const current = captchaRuntime.session === session ? session : null;
    diagnostics.event("attempt.cancel");
    resetCaptchaController();
    current?.reject(signal?.reason);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const allowInteractive = options.allowInteractive !== false;
    const preferInteractive = options.preferInteractive === true;
    const timeoutMs = options.timeoutMs;
    const attemptKind = preferInteractive ? "interactive" : allowInteractive ? "auto" : "traceless";
    let tracelessTimer: number | undefined;
    const clearTracelessTimer = () => {
      if (tracelessTimer !== undefined) {
        window.clearTimeout(tracelessTimer);
        tracelessTimer = undefined;
      }
    };
    controller = await bindCaptchaController(config, diagnostics, signal);
    diagnostics.event("controller.bound", { controllerId: controller.diagnostics.id });
    signal?.throwIfAborted();
    diagnostics.stage("trigger_delay");
    await abortable(waitForCaptchaScriptSettle(), signal);
    signal?.throwIfAborted();
    const bound = controller;
    const verification = new Promise<string>((resolve, reject) => {
      let challenged = false;
      const requestInteractive = (error: unknown) => {
        if (challenged) return;
        challenged = true;
        logger.info("[captcha] aliyun deferred interactive challenge requested", {
          attemptKind,
          fail: readCaptchaFailSummary(error),
        });
        options.onInteractiveChallenge?.();
        logger.info("[captcha] aliyun deferred interactive button click", {
          attemptKind,
          buttonSelector: bound.buttonSelector,
        });
        bound.buttonElement.click();
      };
      const nextSession: CaptchaSession = {
        resolve,
        reject,
        allowInteractive,
        awaitingDeferredSdkSuccess: false,
        handleDeferredFail: allowInteractive ? requestInteractive : undefined,
      };
      captchaRuntime.session = nextSession;
      session = nextSession;
      const isCurrent = () =>
        captchaRuntime.controller === bound && captchaRuntime.session === session;
      void (async () => {
        let instance: AliyunCaptchaInstance;
        try {
          diagnostics.stage("instance_wait");
          instance = await waitForCaptchaInstance(bound.instancePromise, {
            configKey: bound.configKey,
            initStartedAt: bound.initStartedAt,
            signal,
          });
        } catch (error) {
          if (!isCurrent()) return;
          rejectCaptchaSession(
            !allowInteractive && !(error instanceof CaptchaInteractiveRequiredError)
              ? new CaptchaInteractiveRequiredError(
                  "Captcha instance was not ready for traceless verification.",
                )
              : error,
          );
          return;
        }
        if (!isCurrent()) return;
        diagnostics.stage("verification");
        try {
          executeCaptchaInstance({
            instance,
            controller: bound,
            session: nextSession,
            allowInteractive,
            preferInteractive,
            attemptKind,
            timeoutMs,
            onInteractiveChallenge: options.onInteractiveChallenge,
            requestInteractive,
            armTracelessTimer: (callback) => {
              tracelessTimer = window.setTimeout(() => {
                tracelessTimer = undefined;
                callback();
              }, CAPTCHA_TRACELESS_FALLBACK_MS);
            },
          });
        } catch (error) {
          rejectCaptchaSession(error);
        }
      })();
    });
    if (timeoutMs !== undefined && timeoutMs > 0) {
      let timer: number | undefined;
      const timeout = new Promise<never>(() => {
        timer = window.setTimeout(() => {
          if (!captchaRuntime.session || captchaRuntime.session !== session) return;
          if (!allowInteractive && captchaRuntime.session.awaitingDeferredSdkSuccess) {
            debugCaptcha("traceless.timeout.skipped", {
              reason: "awaiting_deferred_sdk_success",
              timeoutMs,
            });
            return;
          }
          debugCaptcha(allowInteractive ? "interactive.timeout" : "traceless.timeout", {
            timeoutMs,
          });
          rejectCaptchaSession(
            allowInteractive
              ? new Error(`Captcha verification timed out after ${timeoutMs}ms.`)
              : new CaptchaInteractiveRequiredError(
                  `Traceless captcha timed out after ${timeoutMs}ms.`,
                ),
          );
        }, timeoutMs);
      });
      try {
        return await Promise.race([verification, timeout]);
      } catch (error) {
        captchaRuntime.session = null;
        throw error;
      } finally {
        clearTracelessTimer();
        if (timer !== undefined) window.clearTimeout(timer);
      }
    }
    try {
      return await verification;
    } finally {
      clearTracelessTimer();
    }
  } catch (error) {
    failure = error;
    outcome = signal?.aborted ? "cancelled" : "error";
    captchaRuntime.session = null;
    throw error;
  } finally {
    diagnostics.end(outcome, failure, {
      controllerId: controller?.diagnostics.id,
      ...controller?.diagnostics.snapshot(),
    });
    signal?.removeEventListener("abort", onAbort);
    if (signal?.aborted) onAbort();
    if (controller && captchaRuntime.controller === controller) resetCaptchaController();
    captchaRuntime.busy = false;
  }
}

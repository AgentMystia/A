import { logger } from "@/logger.js";

import { ALIYUN_CAPTCHA_LOGO } from "./captchaLogo.js";

// 发布包只保留一份 logo 绑定。两处直接引用导入的字符串常量会被 styles 各内联一次。
const captchaLogoHolder = {
  href: new URL(ALIYUN_CAPTCHA_LOGO, "" + import.meta.url).href,
};

function readDefaultCaptchaLogo(): string {
  return captchaLogoHolder.href;
}
import {
  ALIYUN_CAPTCHA_SCRIPT_URL,
  CAPTCHA_BUTTON_ID,
  CAPTCHA_CONTAINER_ID,
  CAPTCHA_ELEMENT_ID,
  abortable,
} from "./captchaDom.js";
import type { CaptchaDiagnostics } from "./captchaDiagnostics.js";
import {
  CaptchaInteractiveRequiredError,
  isCaptchaInteractiveRequired,
  isCaptchaTerminalPass,
  isDuplicateCaptchaSubmission,
  readCaptchaFailSummary,
  readCaptchaSdkError,
  readCaptchaVerifyParam,
} from "./captchaResult.js";
import {
  captchaRuntime,
  type AliyunCaptchaInstance,
  type CaptchaController,
} from "./captchaRuntimeState.js";

interface AliyunCaptchaInitOptions {
  SceneId: string;
  mode: string;
  language?: string;
  captchaLogoImg: string;
  showErrorTip: false;
  element: string;
  button: string;
  getInstance: (instance: AliyunCaptchaInstance) => void;
  success: (param: string) => void;
  fail: (error: unknown) => void;
  onError: (error: unknown) => void;
}

type CaptchaWindow = Window & {
  initAliyunCaptcha?: (options: AliyunCaptchaInitOptions) => void;
  AliyunCaptchaConfig?: { region: string; prefix: string };
};

export interface AliyunCaptchaRunConfig {
  region: string;
  prefix: string;
  sceneId: string;
  mode?: string;
  language?: string;
  captchaLogoImg?: string;
}

function captchaWindow(): CaptchaWindow {
  return window as CaptchaWindow;
}

function debugCaptcha(event: string, payload: unknown): void {
  logger.debug("[captcha]", event, payload);
}

export function rejectCaptchaSession(error: unknown): void {
  const current = captchaRuntime.session;
  captchaRuntime.session = null;
  current?.reject(error);
}

export function resetCaptchaController(): void {
  const current = captchaRuntime.controller;
  current?.diagnostics.event("controller.reset", { controllerId: current.diagnostics.id });
  captchaRuntime.session = null;
  captchaRuntime.controller = null;
  if (typeof document !== "undefined") {
    document.getElementById(CAPTCHA_ELEMENT_ID)?.replaceChildren();
  }
}

function captchaConfigKey(config: AliyunCaptchaRunConfig): string {
  return [
    config.region,
    config.prefix,
    config.sceneId,
    config.mode ?? "popup",
    config.language ?? "",
    config.captchaLogoImg ?? readDefaultCaptchaLogo(),
  ].join("::");
}

function requireHostElements(): void {
  const container = document.getElementById(CAPTCHA_CONTAINER_ID);
  const mount = document.getElementById(CAPTCHA_ELEMENT_ID);
  const button = document.getElementById(CAPTCHA_BUTTON_ID);
  if (!(container instanceof HTMLElement))
    throw new Error("Captcha host container is not mounted.");
  if (!(mount instanceof HTMLElement)) throw new Error("Captcha host element is not mounted.");
  if (!(button instanceof HTMLButtonElement))
    throw new Error("Captcha host button is not mounted.");
}

function requireFallbackButton(): { buttonElement: HTMLButtonElement; buttonSelector: string } {
  const button = document.getElementById(CAPTCHA_BUTTON_ID);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("Captcha fallback button is not mounted.");
  }
  return { buttonElement: button, buttonSelector: `#${CAPTCHA_BUTTON_ID}` };
}

export function loadAliyunCaptchaScript(): Promise<void> {
  if (!captchaRuntime.script) {
    captchaRuntime.script = new Promise<void>((resolve, reject) => {
      if (typeof window === "undefined" || typeof document === "undefined") {
        reject(new Error("Captcha requires browser environment."));
        return;
      }
      if (typeof captchaWindow().initAliyunCaptcha === "function") {
        resolve();
        return;
      }
      const fail = (script: Element) => {
        script.remove();
        reject(new Error("Failed to load captcha script."));
      };
      const existing = document.querySelector(`script[src="${ALIYUN_CAPTCHA_SCRIPT_URL}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => fail(existing), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = ALIYUN_CAPTCHA_SCRIPT_URL;
      script.async = true;
      script.onload = () => {
        captchaRuntime.scriptLoadedAt = Date.now();
        resolve();
      };
      script.onerror = () => fail(script);
      document.head.appendChild(script);
    }).catch((error: unknown) => {
      captchaRuntime.script = null;
      throw error;
    });
  }
  return captchaRuntime.script;
}

function handleSdkFail(error: unknown, rejectInstance: (error: unknown) => void): void {
  const summary = readCaptchaFailSummary(error);
  if (!captchaRuntime.session && isCaptchaInteractiveRequired(error)) {
    debugCaptcha("sdk.fail.stale_after_success", summary);
    return;
  }
  debugCaptcha("sdk.fail", summary);
  logger.info("[captcha] aliyun sdk fail", summary);
  if (isCaptchaTerminalPass(error)) {
    const param = readCaptchaVerifyParam(error);
    if (param) {
      debugCaptcha("sdk.fail.terminal_pass", summary);
      logger.info("[captcha] aliyun sdk terminal pass from fail", summary);
      const session = captchaRuntime.session;
      captchaRuntime.session = null;
      session?.resolve(param);
      return;
    }
  }
  if (isCaptchaInteractiveRequired(error)) {
    const session = captchaRuntime.session;
    if (!session) {
      rejectInstance(new CaptchaInteractiveRequiredError());
      return;
    }
    if (!session.allowInteractive) {
      rejectCaptchaSession(new CaptchaInteractiveRequiredError());
      return;
    }
    session.awaitingDeferredSdkSuccess = true;
    session.handleDeferredFail?.(error);
    return;
  }
  if (isDuplicateCaptchaSubmission(error)) {
    debugCaptcha("sdk.fail.duplicate", summary);
    logger.warn("[captcha] aliyun sdk duplicate submission", summary);
    const session = captchaRuntime.session;
    resetCaptchaController();
    if (session && !session.allowInteractive) {
      session.reject(new CaptchaInteractiveRequiredError());
      return;
    }
    session?.reject(error ?? new Error("Captcha verification data was already submitted."));
    return;
  }
  if (captchaRuntime.session && !captchaRuntime.session.allowInteractive) {
    rejectCaptchaSession(new CaptchaInteractiveRequiredError());
    return;
  }
  rejectInstance(error ?? new Error("Captcha failed before instance ready."));
  rejectCaptchaSession(error ?? new Error("Captcha failed."));
}

export async function bindCaptchaController(
  config: AliyunCaptchaRunConfig,
  diagnostics: CaptchaDiagnostics,
  signal?: AbortSignal,
): Promise<CaptchaController> {
  signal?.throwIfAborted();
  const configKey = captchaConfigKey(config);
  if (captchaRuntime.controller?.configKey === configKey) return captchaRuntime.controller;
  diagnostics.stage("script_load");
  await abortable(loadAliyunCaptchaScript(), signal);
  diagnostics.event("script.ready");
  signal?.throwIfAborted();
  if (captchaRuntime.controller?.configKey === configKey) return captchaRuntime.controller;
  const init = captchaWindow().initAliyunCaptcha;
  if (typeof init !== "function") throw new Error("Captcha SDK is unavailable.");
  requireHostElements();
  const { buttonElement, buttonSelector } = requireFallbackButton();
  captchaWindow().AliyunCaptchaConfig = { region: config.region, prefix: config.prefix };
  let resolveInstance: (instance: AliyunCaptchaInstance) => void = () => undefined;
  let rejectInstance: (error: unknown) => void = () => undefined;
  const instancePromise = new Promise<AliyunCaptchaInstance>((resolve, reject) => {
    resolveInstance = resolve;
    rejectInstance = reject;
  });
  const controller: CaptchaController = {
    diagnostics,
    configKey,
    buttonElement,
    buttonSelector,
    instancePromise,
    rejectInstance,
    initStartedAt: Date.now(),
  };
  captchaRuntime.controller = controller;
  const isCurrent = () => captchaRuntime.controller === controller;
  const logo = config.captchaLogoImg ?? readDefaultCaptchaLogo();
  try {
    logger.info("[captcha] aliyun sdk init start", {
      configKey,
      mode: config.mode ?? "popup",
      language: config.language ?? null,
      hasCaptchaLogoImg: Boolean(logo),
    });
    diagnostics.stage("sdk_init");
    init({
      SceneId: config.sceneId,
      mode: config.mode ?? "popup",
      language: config.language,
      captchaLogoImg: logo,
      showErrorTip: false,
      element: `#${CAPTCHA_ELEMENT_ID}`,
      button: buttonSelector,
      getInstance: (instance) => {
        diagnostics.callback("getInstance", isCurrent(), captchaRuntime.controller?.diagnostics.id);
        if (!isCurrent()) return;
        logger.info("[captcha] aliyun sdk instance ready", {
          configKey,
          hasShow: typeof instance.show === "function",
          hasStartTracelessVerification: typeof instance.startTracelessVerification === "function",
        });
        resolveInstance(instance);
      },
      success: (param) => {
        diagnostics.callback("success", isCurrent(), captchaRuntime.controller?.diagnostics.id);
        if (!isCurrent()) return;
        debugCaptcha("sdk.success", { paramLength: param.length });
        logger.info("[captcha] aliyun sdk success", { paramLength: param.length });
        const session = captchaRuntime.session;
        captchaRuntime.session = null;
        session?.resolve(param);
      },
      fail: (error) => {
        diagnostics.callback("fail", isCurrent(), captchaRuntime.controller?.diagnostics.id, error);
        if (isCurrent()) handleSdkFail(error, rejectInstance);
      },
      onError: (error) => {
        diagnostics.callback(
          "onError",
          isCurrent(),
          captchaRuntime.controller?.diagnostics.id,
          error,
        );
        if (!isCurrent()) return;
        logger.warn("[captcha] aliyun sdk onError", { configKey, ...readCaptchaSdkError(error) });
        if (captchaRuntime.session && !captchaRuntime.session.allowInteractive) {
          rejectCaptchaSession(new CaptchaInteractiveRequiredError());
          return;
        }
        rejectInstance(error ?? new Error("Captcha errored before instance ready."));
        rejectCaptchaSession(error ?? new Error("Captcha errored."));
      },
    });
  } catch (error) {
    captchaRuntime.controller = null;
    logger.warn("[captcha] aliyun sdk init threw", { configKey, ...readCaptchaSdkError(error) });
    throw error;
  }
  return controller;
}

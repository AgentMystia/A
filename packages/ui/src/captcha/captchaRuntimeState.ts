import type { CaptchaDiagnostics } from "./captchaDiagnostics.js";

export interface AliyunCaptchaConfig {
  enabled?: unknown;
  region?: string;
  prefix?: string;
  sceneId?: string;
}

export interface AliyunCaptchaInstance {
  show?: () => void;
  startTracelessVerification?: () => void;
}

export interface CaptchaSession {
  resolve: (param: string) => void;
  reject: (error: unknown) => void;
  allowInteractive: boolean;
  awaitingDeferredSdkSuccess: boolean;
  handleDeferredFail?: (error: unknown) => void;
}

export interface CaptchaController {
  diagnostics: CaptchaDiagnostics;
  configKey: string;
  buttonElement: HTMLButtonElement;
  buttonSelector: string;
  instancePromise: Promise<AliyunCaptchaInstance>;
  rejectInstance: (error: unknown) => void;
  initStartedAt: number;
}

export interface CaptchaArmsReporter {
  reportArmsCustomEvent(payload: {
    name: string;
    group: string;
    value?: number;
    properties?: Record<string, string | number | boolean | undefined>;
  }): Promise<unknown>;
}

export interface CaptchaHeaderRequest {
  promise: Promise<void>;
  controller: AbortController;
}

export const captchaRuntime = {
  script: null as Promise<void> | null,
  scriptLoadedAt: 0,
  controller: null as CaptchaController | null,
  session: null as CaptchaSession | null,
  busy: false,
  configCache: null as { value: AliyunCaptchaConfig | null; expiresAt: number } | null,
  configInflight: null as Promise<AliyunCaptchaConfig | null> | null,
  queue: Promise.resolve() as Promise<void>,
  params: new Map<string, { param: string; obtainedAt: number }>(),
  certifyIds: new Map<string, string>(),
  arms: null as CaptchaArmsReporter | null,
  headerRequests: new Map<string, CaptchaHeaderRequest>(),
};

export function resetCaptchaRuntimeForTests(): void {
  captchaRuntime.script = null;
  captchaRuntime.scriptLoadedAt = 0;
  captchaRuntime.controller = null;
  captchaRuntime.session = null;
  captchaRuntime.busy = false;
  captchaRuntime.configCache = null;
  captchaRuntime.configInflight = null;
  captchaRuntime.queue = Promise.resolve();
  captchaRuntime.params.clear();
  captchaRuntime.certifyIds.clear();
  captchaRuntime.arms = null;
  for (const pending of captchaRuntime.headerRequests.values()) {
    if (!pending.controller.signal.aborted) pending.controller.abort();
  }
  captchaRuntime.headerRequests.clear();
}

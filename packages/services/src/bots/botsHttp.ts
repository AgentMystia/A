export interface BotProviderFetchResult {
  ok: boolean;
  status: number;
}

export interface BotProviderJsonResult<T = unknown> extends BotProviderFetchResult {
  payload?: T;
  responseLogId?: string;
}

/** 发布包 host `runBotProviderRequest`：超时与上游 abort 合成一个 AbortController。 */
export async function runBotProviderRequest<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const upstream = init.signal;
  const onAbort = () => controller.abort(upstream?.reason);
  if (upstream?.aborted) {
    onAbort();
  } else {
    upstream?.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => {
    controller.abort(new Error(`Bot provider request timed out after ${timeoutMs}ms.`));
  }, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await read(response);
  } finally {
    clearTimeout(timer);
    upstream?.removeEventListener("abort", onAbort);
  }
}

export async function fetchBotProvider(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<BotProviderFetchResult> {
  return runBotProviderRequest(url, init, timeoutMs, async (response) => {
    await response.arrayBuffer();
    return { ok: response.ok, status: response.status };
  });
}

export async function fetchBotProviderJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<BotProviderJsonResult<T>> {
  return runBotProviderRequest(url, init, timeoutMs, async (response) => {
    const text = await response.text();
    let payload: T | undefined;
    if (text) {
      try {
        payload = JSON.parse(text) as T;
      } catch (error) {
        if (response.ok) {
          throw error;
        }
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      payload,
      responseLogId: response.headers.get("x-tt-logid") ?? undefined,
    };
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 发布包 host `waitFor`：可被 abort 打断的定时等待。 */
export function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      resolve();
    };
    const onAbort = () => finish();
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/** 发布包 host `postWebhookWithRetry`：0/500/1500ms 重试，4xx 立即返回。 */
export async function postWebhookWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastResponse: Response | null = null;
  let lastError: unknown;
  for (const waitMs of [0, 500, 1500]) {
    if (waitMs > 0) {
      await delay(waitMs);
    }
    try {
      const response = await fetch(url, init);
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }
      lastResponse = response;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastResponse) {
    return lastResponse;
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

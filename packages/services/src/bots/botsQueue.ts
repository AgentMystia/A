import { createHash } from "node:crypto";

export function createBotConnectionFingerprint(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** 发布包 host `createLatestRuntimeRefreshQueue`：只保留最新一次 reconcile。 */
export function createLatestRuntimeRefreshQueue(): {
  enqueue(run: (isCurrent: () => boolean) => Promise<void>): Promise<void>;
  invalidate(): void;
} {
  let generation = 0;
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue(run) {
      const current = ++generation;
      const next = tail.catch(() => undefined).then(() => run(() => current === generation));
      tail = next.catch(() => undefined);
      return next;
    },
    invalidate() {
      generation += 1;
    },
  };
}

export function assertBotCallbackSucceeded(
  providerLabel: string,
  result: { ok: boolean; status?: number },
): void {
  if (!result.ok) {
    throw new Error(`${providerLabel} callback failed: status=${result.status ?? "unknown"}`);
  }
}

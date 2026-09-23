import { createHash } from "node:crypto";

// 发布包把这四个值打在连接指纹模块开头，和锁函数共用同一条 var。
// const 会被内联成多处 1e4 / 3e4，所以必须是 var。
/* oxlint-disable eslint(no-var) -- 见上 */
export var TELEGRAM_ELSEWHERE_WAIT_MS = 10_000;
export var LOCK_HELD_TTL_MS = 30_000;
export var LEASE_TOUCH_MS = 10_000;
export var BOT_RUNTIME_LOCK_CLEANUP_RETRY_MS = [100, 250, 500];
/* oxlint-enable eslint(no-var) */

export function createBotConnectionFingerprint(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function assertBotCallbackSucceeded(
  providerLabel: string,
  result: { ok: boolean; status?: number },
): void {
  if (!result.ok) {
    throw new Error(`${providerLabel} callback failed: status=${result.status ?? "unknown"}`);
  }
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

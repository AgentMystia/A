export interface MarketingTouchPoller {
  refresh: () => void;
  visibilityChanged: () => void;
  dispose: () => void;
}

export function marketingPollIntervalMs(mode: string | undefined): number {
  return mode === "production" ? 10 * 60_000 : 30_000;
}

export function marketingPollDelayMs(failures: number, intervalMs: number): number {
  return failures ? Math.min(600_000, 30_000 * 2 ** Math.min(failures - 1, 5)) : intervalMs;
}

/** 可见性门闩下的单飞查询。失败只增加退避，不保存投放。 */
export function createMarketingTouchPoller(input: {
  intervalMs: number;
  query: () => Promise<void>;
  visible: () => boolean;
}): MarketingTouchPoller {
  let disposed = false;
  let inFlight = false;
  let queued = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  function refresh() {
    if (disposed) return;
    clear();
    if (!input.visible()) return;
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    input
      .query()
      .then(
        () => {
          failures = 0;
        },
        () => {
          failures += 1;
        },
      )
      .finally(() => {
        inFlight = false;
        if (disposed || !input.visible()) return;
        if (queued) {
          queued = false;
          refresh();
          return;
        }
        timer = setTimeout(refresh, marketingPollDelayMs(failures, input.intervalMs));
      });
  }
  return {
    refresh,
    visibilityChanged() {
      if (input.visible()) refresh();
      else {
        clear();
        queued = false;
      }
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}

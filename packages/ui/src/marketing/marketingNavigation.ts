import type { SettingsSectionId } from "@/lib/settingsNavigation.js";
import type { MarketingDelivery } from "@zcode/shared";
import { createStore } from "zustand/vanilla";

export type MarketingButtonAction = Extract<
  MarketingDelivery,
  { resource_position: "popup" }
>["popup"]["buttons"][number]["action"];

export type MarketingNavigateTarget = Extract<MarketingButtonAction, { type: "navigate" }>["args"];

interface MarketingNavigationRequest {
  id: number;
  target: MarketingNavigateTarget;
  finish: (error?: Error) => void;
}

export const marketingNavigationStore = createStore<{ request: MarketingNavigationRequest | null }>(
  () => ({ request: null }),
);

let nextNavigationId = 0;

export const MARKETING_SETTINGS_SECTION = {
  general: "general",
  appearance: "appearance",
  models: "modelProvider",
  browser: "browser",
  computer_use: "computerUse",
  memory: "memory",
  subagents: "subagents",
  plugins: "plugin",
  mcp: "mcp",
  skills: "skill",
  commands: "commands",
  hooks: "hooks",
  usage: "usage",
} as const satisfies Record<string, SettingsSectionId>;

export function acknowledgeMarketingNavigation(id: number, error?: Error): void {
  const request = marketingNavigationStore.getState().request;
  if (request?.id !== id) return;
  request.finish(error);
}

export async function raceMarketingCapability<T>(
  task: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_resolve, reject) => {
        onAbort = () => reject(new Error("marketing_capability_cancelled"));
        timer = setTimeout(() => reject(new Error("marketing_capability_timeout")), timeoutMs);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/** 同一时刻只有一条导航。目的地稍后调用 acknowledge 才会结束这 30 秒等待。 */
export async function requestMarketingNavigation(
  target: MarketingNavigateTarget,
  signal: AbortSignal,
  run: () => void,
): Promise<void> {
  signal.throwIfAborted();
  if (marketingNavigationStore.getState().request) {
    throw new Error("marketing_navigation_busy");
  }
  const id = ++nextNavigationId;
  const pending = new Promise<void>((resolve, reject) => {
    marketingNavigationStore.setState({
      request: {
        id,
        target,
        finish: (error) => (error ? reject(error) : resolve()),
      },
    });
  });
  try {
    const raced = raceMarketingCapability(pending, signal, 30_000);
    try {
      run();
    } catch {
      acknowledgeMarketingNavigation(id, new Error("marketing_navigation_unavailable"));
    }
    await raced;
  } finally {
    if (marketingNavigationStore.getState().request?.id === id) {
      marketingNavigationStore.setState({ request: null });
    }
  }
}

export function resetMarketingNavigationForTests(): void {
  nextNavigationId = 0;
  marketingNavigationStore.setState({ request: null });
}

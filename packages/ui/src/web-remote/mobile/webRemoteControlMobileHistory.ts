import type { WebRemoteControlMobileNavigationIntent } from "@/web-remote/mobile/webRemoteControlMobileTypes.js";

export function isMobileChatHistoryState(state: unknown): boolean {
  return (
    typeof state === "object" &&
    !!state &&
    (state as { zcodeMobilePage?: unknown }).zcodeMobilePage === "chat"
  );
}

export function resolveInitialMobilePage(
  intent: WebRemoteControlMobileNavigationIntent | undefined,
): "home" | "chat" {
  if (intent === "chat") return "chat";
  if (typeof window !== "undefined" && isMobileChatHistoryState(window.history.state)) {
    return "chat";
  }
  return "home";
}

export function pushMobileChatHistory(): void {
  if (typeof window === "undefined" || isMobileChatHistoryState(window.history.state)) return;
  window.history.pushState({ zcodeMobilePage: "chat" }, "");
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Loader } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import {
  isMobileChatHistoryState,
  pushMobileChatHistory,
  resolveInitialMobilePage,
} from "@/web-remote/mobile/webRemoteControlMobileHistory.js";
import {
  readMobileTaskHomePreferences,
  stringifyMobileHomeError,
  writeMobileTaskHomePreferences,
} from "@/web-remote/mobile/webRemoteControlMobileModel.js";
import { WebRemoteControlMobileTaskHome } from "@/web-remote/mobile/WebRemoteControlMobileTaskHome.js";
import { WebRemoteControlThemeMenu } from "@/web-remote/mobile/WebRemoteControlThemeMenu.js";
import { useWebRemoteControlTerminalTransport } from "@/web-remote/mobile/webRemoteControlMobileTransport.js";
import type {
  WebRemoteControlMobileNavigationIntent,
  WebRemoteControlMobileSwitcher,
  WebRemoteControlMobileWorkspaceList,
  WebRemoteControlTerminalTransportState,
} from "@/web-remote/mobile/webRemoteControlMobileTypes.js";

export function WebRemoteControlMobileShell({
  activeTaskId,
  activeWorkspaceIdentity,
  activeWorkspacePath,
  chatContent,
  chatOverlay,
  initialNavigationIntent,
  initialWorkspaceList,
  isSidePaneOpen = false,
  onCloseSidePane,
  onSelectTask,
  onStartDraftInWorkspace,
  renderChatHeader,
  sidePaneContent,
  switcher,
  webRemoteControlTerminalTransportState,
}: {
  activeTaskId?: string | null;
  activeWorkspaceIdentity?: string;
  activeWorkspacePath: string;
  chatContent: ReactNode;
  chatOverlay?: ReactNode;
  initialNavigationIntent?: WebRemoteControlMobileNavigationIntent;
  initialWorkspaceList?: WebRemoteControlMobileWorkspaceList;
  isSidePaneOpen?: boolean;
  onCloseSidePane?: () => void;
  onSelectTask: (workspacePath: string, taskId: string, workspaceIdentity?: string) => void;
  onStartDraftInWorkspace?: (workspacePath: string, workspaceIdentity?: string) => void;
  renderChatHeader: (input: { onBackHome: () => void }) => ReactNode;
  sidePaneContent?: ReactNode;
  switcher: WebRemoteControlMobileSwitcher;
  webRemoteControlTerminalTransportState?: WebRemoteControlTerminalTransportState;
}) {
  const { intl } = useZCodeIntl();
  const [page, setPage] = useState(() => resolveInitialMobilePage(initialNavigationIntent));
  const [preferences, setPreferences] = useState(() => readMobileTaskHomePreferences());
  const [refreshKey, setRefreshKey] = useState(0);
  const [switching, setSwitching] = useState(false);
  const transport = useWebRemoteControlTerminalTransport(webRemoteControlTerminalTransportState);
  const syncedViewKey = useRef<string | null>(null);
  const sidePaneOverlay = !!sidePaneContent && isSidePaneOpen;
  const showChat = useCallback(() => {
    setPage("chat");
    pushMobileChatHistory();
  }, []);
  const changePreferences = useCallback(
    (next: ReturnType<typeof readMobileTaskHomePreferences>) => {
      writeMobileTaskHomePreferences(next);
      logger.debug("[WebRemoteControlMobileShell] 更新手机端任务首页偏好", next);
      setPreferences(next);
    },
    [],
  );
  const backHome = useCallback(() => {
    setRefreshKey((current) => current + 1);
    if (typeof window !== "undefined" && isMobileChatHistoryState(window.history.state)) {
      window.history.back();
      return;
    }
    setPage("home");
  }, []);

  useEffect(() => {
    if (initialNavigationIntent === "chat") showChat();
  }, [initialNavigationIntent, showChat]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = (event: PopStateEvent) => {
      const next = isMobileChatHistoryState(event.state) ? "chat" : "home";
      setPage(next);
      if (next === "home") setRefreshKey((current) => current + 1);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    if (!switcher.updateMobileViewState) return;
    const workspaceKey = getWorkspaceKey(activeWorkspacePath, activeWorkspaceIdentity);
    const viewKey = `${workspaceKey}:${activeTaskId ?? ""}`;
    if (syncedViewKey.current === viewKey) return;
    syncedViewKey.current = viewKey;
    void switcher
      .updateMobileViewState(workspaceKey, activeTaskId ?? undefined)
      .catch((error: unknown) => {
        logger.warn("[WebRemoteControlMobileShell] 同步 mobileViewState 失败", {
          error: stringifyMobileHomeError(error),
          workspaceKey,
          taskId: activeTaskId ?? null,
        });
      });
  }, [activeTaskId, activeWorkspaceIdentity, activeWorkspacePath, switcher]);

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col bg-background">
      {page === "home" ? (
        <WebRemoteControlMobileTaskHome
          activeTaskId={activeTaskId}
          activeWorkspaceIdentity={activeWorkspaceIdentity}
          activeWorkspacePath={activeWorkspacePath}
          initialResult={initialWorkspaceList}
          onCrossWorkspaceSwitchingChange={setSwitching}
          onNavigateHome={backHome}
          onNavigateToChat={showChat}
          preferences={preferences}
          onPreferencesChange={changePreferences}
          refreshKey={refreshKey}
          onSelectTask={onSelectTask}
          onStartDraftInWorkspace={onStartDraftInWorkspace}
          switcher={switcher}
        />
      ) : (
        <section
          className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground"
          data-mobile-page="chat"
        >
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-header px-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={intl.formatMessage({ id: "webRemoteControl.mobileShell.backHome" })}
              onClick={backHome}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <span className="min-w-0 flex-1 truncate text-ui-base font-medium">
              {intl.formatMessage({ id: "webRemoteControl.mobileShell.chatTitle" })}
            </span>
            <WebRemoteControlThemeMenu />
          </div>
          {renderChatHeader({ onBackHome: backHome })}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <main
              className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              aria-hidden={sidePaneOverlay ? true : undefined}
              data-mobile-chat-surface={sidePaneOverlay ? "inert" : undefined}
              inert={sidePaneOverlay ? true : undefined}
            >
              {chatContent}
            </main>
            {sidePaneContent ? (
              <div
                className={[
                  "absolute inset-0 z-30 transition-opacity duration-200 ease-out",
                  isSidePaneOpen ? "opacity-100" : "pointer-events-none opacity-0",
                ].join(" ")}
                aria-hidden={!isSidePaneOpen}
                data-mobile-side-pane-overlay="true"
              >
                <button
                  type="button"
                  className="absolute inset-0 bg-background/60 backdrop-blur-[1px]"
                  aria-label={intl.formatMessage({ id: "sidePane.collapse" })}
                  onClick={onCloseSidePane}
                />
                <div
                  className={[
                    "absolute top-0 right-0 h-full w-[min(88vw,28rem)] max-w-full border-l border-border bg-background shadow-2xl transition-transform duration-200 ease-out",
                    isSidePaneOpen ? "translate-x-0" : "translate-x-full",
                  ].join(" ")}
                >
                  {sidePaneContent}
                </div>
              </div>
            ) : null}
            {chatOverlay ? (
              <div
                className="pointer-events-none absolute inset-0 z-40"
                data-mobile-chat-overlay="true"
              >
                <div className="pointer-events-auto">{chatOverlay}</div>
              </div>
            ) : null}
          </div>
        </section>
      )}
      {switching ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-background/72 backdrop-blur-[1px]"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-ui-base text-foreground-subtle shadow-sm">
            <Loader className="size-4 animate-spin" />
            {intl.formatMessage({ id: "common.loading" })}
          </div>
        </div>
      ) : null}
      {transport === "reconnecting" ? (
        <div
          className="pointer-events-none absolute top-3 left-1/2 z-50 flex -translate-x-1/2 justify-center px-3"
          aria-live="polite"
          aria-busy="true"
          data-web-remote-control-reconnect-notice="true"
        >
          <div className="flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-lg border border-border bg-toast px-3 py-2 text-ui-base text-foreground shadow-lg">
            <Loader className="size-4 shrink-0 animate-spin text-foreground-subtle" />
            <span className="min-w-0 whitespace-nowrap">
              {intl.formatMessage({ id: "webRemoteControl.mobileShell.reconnecting" })}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

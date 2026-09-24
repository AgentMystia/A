import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Locale, WebRemoteControlWorkspaceSnapshot } from "@zcode/shared";
import { ChevronsUp, Loader, RefreshCw } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { groupTaskTimelineItems } from "@/lib/taskTimelineGroups.js";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import { WebRemoteControlMobileOrganizeMenu } from "@/web-remote/mobile/WebRemoteControlMobileOrganizeMenu.js";
import { WebRemoteControlMobileTaskSections } from "@/web-remote/mobile/WebRemoteControlMobileTaskSections.js";
import { WebRemoteControlThemeMenu } from "@/web-remote/mobile/WebRemoteControlThemeMenu.js";
import {
  buildMobileTaskHomeView,
  EMPTY_MOBILE_WORKSPACE_LIST,
  mobileHomeInitialTaskMatched,
  stringifyMobileHomeError,
} from "@/web-remote/mobile/webRemoteControlMobileModel.js";
import type {
  WebRemoteControlMobileSwitcher,
  WebRemoteControlMobileTaskHomePreferences,
  WebRemoteControlMobileWorkspaceList,
} from "@/web-remote/mobile/webRemoteControlMobileTypes.js";
import { useWebRemoteControlTaskOpen } from "@/web-remote/mobile/useWebRemoteControlTaskOpen.js";

export function WebRemoteControlMobileTaskHome({
  activeTaskId,
  activeWorkspaceIdentity,
  activeWorkspacePath,
  initialResult,
  onNavigateHome,
  onNavigateToChat,
  onOpenTask,
  preferences,
  onPreferencesChange,
  onSelectTask,
  onStartDraftInWorkspace,
  refreshKey,
  onCrossWorkspaceSwitchingChange,
  switcher,
}: {
  activeTaskId?: string | null;
  activeWorkspaceIdentity?: string;
  activeWorkspacePath: string;
  initialResult?: WebRemoteControlMobileWorkspaceList;
  onNavigateHome?: () => void;
  onNavigateToChat?: () => void;
  onOpenTask?: (task: WebRemoteControlMobileWorkspaceList["tasks"][number]) => void;
  preferences: WebRemoteControlMobileTaskHomePreferences;
  onPreferencesChange: (preferences: WebRemoteControlMobileTaskHomePreferences) => void;
  onSelectTask?: (workspacePath: string, taskId: string, workspaceIdentity?: string) => void;
  onStartDraftInWorkspace?: (workspacePath: string, workspaceIdentity?: string) => void;
  refreshKey: number;
  onCrossWorkspaceSwitchingChange?: (switching: boolean) => void;
  switcher: WebRemoteControlMobileSwitcher;
}) {
  const { intl, locale } = useZCodeIntl();
  const [result, setResult] = useState(initialResult ?? EMPTY_MOBILE_WORKSPACE_LIST);
  const [loading, setLoading] = useState(!initialResult);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = useState<string | null>(null);
  const appliedInitialExpansion = useRef(!!initialResult);
  const view = useMemo(
    () =>
      buildMobileTaskHomeView({
        activeTaskId,
        activeWorkspaceIdentity,
        activeWorkspacePath,
        sortBy: preferences.sortBy,
        result,
      }),
    [activeTaskId, activeWorkspaceIdentity, activeWorkspacePath, preferences.sortBy, result],
  );
  const [expandedKeys, setExpandedKeys] = useState(
    () =>
      new Set(
        buildMobileTaskHomeView({
          activeTaskId,
          activeWorkspaceIdentity,
          activeWorkspacePath,
          sortBy: preferences.sortBy,
          result: initialResult ?? EMPTY_MOBILE_WORKSPACE_LIST,
        }).defaultExpandedWorkspaceKeys,
      ),
  );
  const expandedSignature = useMemo(
    () => [...view.defaultExpandedWorkspaceKeys].join("\0"),
    [view.defaultExpandedWorkspaceKeys],
  );
  const workspaceByKey = useMemo(
    () => new Map(view.groups.map((group) => [group.workspaceKey, group.workspace])),
    [view.groups],
  );
  const timelineGroups = useMemo(
    () =>
      groupTaskTimelineItems(view.timelineTasks, {
        sortBy: preferences.sortBy,
        now: Date.now(),
        locale: locale as Locale,
      }),
    [locale, preferences.sortBy, view.timelineTasks],
  );
  const {
    error: openError,
    openTask,
    switchingTaskKey,
  } = useWebRemoteControlTaskOpen({
    activeWorkspaceIdentity,
    activeWorkspacePath,
    markTaskReadOnOpen: true,
    mobileNavigationIntent: "chat",
    onNavigateHome,
    onNavigateToChat,
    onSelectTask: onSelectTask ?? (() => undefined),
    onSwitchingChange: onCrossWorkspaceSwitchingChange,
    switcher,
  });
  const visibleError = loadError ?? openError;
  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setResult(await switcher.listWorkspaces());
    } catch (error) {
      const message = stringifyMobileHomeError(error);
      logger.error("[WebRemoteControlMobileTaskHome] 加载远控首页失败", { error: message });
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [switcher]);

  useEffect(() => {
    if (!initialResult) void loadWorkspaces();
  }, [initialResult, loadWorkspaces]);
  useEffect(() => {
    if (refreshKey) void loadWorkspaces();
  }, [loadWorkspaces, refreshKey]);
  useEffect(
    () =>
      switcher.onWorkspaceListUpdated?.((next) => {
        setResult(next);
        setLoadError(null);
        setLoading(false);
      }),
    [switcher],
  );
  useEffect(() => {
    if (appliedInitialExpansion.current || loading) return;
    appliedInitialExpansion.current = true;
    setExpandedKeys(new Set(view.defaultExpandedWorkspaceKeys));
  }, [expandedSignature, loading, view.defaultExpandedWorkspaceKeys]);
  useEffect(() => {
    if (loading || result.workspaces.length === 0) return;
    if (!view.groups.some((group) => group.workspaceKey === view.activeWorkspaceKey)) {
      logger.warn("[WebRemoteControlMobileTaskHome] 初始 workspace 未匹配", {
        workspaceKey: view.activeWorkspaceKey,
      });
      return;
    }
    if (!mobileHomeInitialTaskMatched(view)) {
      logger.warn("[WebRemoteControlMobileTaskHome] 初始 task 未匹配", {
        taskId: view.activeTaskId,
        workspaceKey: view.activeWorkspaceKey,
      });
    }
  }, [
    loading,
    result.workspaces.length,
    view,
    view.activeTaskId,
    view.activeWorkspaceKey,
    view.groups,
  ]);

  const openDisplayedTask = useCallback(
    (task: WebRemoteControlMobileWorkspaceList["tasks"][number]) => {
      if (onOpenTask) {
        onOpenTask(task);
        return;
      }
      openTask(task);
    },
    [onOpenTask, openTask],
  );
  const reconnectWorkspace = useCallback(
    async (workspace: WebRemoteControlWorkspaceSnapshot) => {
      if (!switcher.reconnectWorkspace) return;
      const workspaceKey = getWorkspaceKey(workspace.workspacePath, workspace.workspaceIdentity);
      setLoadError(null);
      setReconnectKey(workspaceKey);
      try {
        await switcher.reconnectWorkspace(workspaceKey);
        await loadWorkspaces();
      } catch (error) {
        const message = stringifyMobileHomeError(error);
        logger.error("[WebRemoteControlMobileTaskHome] 手机端重连远程工作区失败", {
          error: message,
          workspaceKey,
        });
        setLoadError(message);
      } finally {
        setReconnectKey(null);
      }
    },
    [loadWorkspaces, switcher],
  );
  const startDraft = useCallback(
    async (workspace: WebRemoteControlWorkspaceSnapshot) => {
      const workspaceKey = getWorkspaceKey(workspace.workspacePath, workspace.workspaceIdentity);
      const sameWorkspace = workspaceKey === view.activeWorkspaceKey;
      setLoadError(null);
      setDraftKey(workspaceKey);
      onCrossWorkspaceSwitchingChange?.(true);
      try {
        if (switcher.startDraft) {
          await switcher.startDraft(workspaceKey, { mobileNavigationIntent: "chat" });
        } else {
          await switcher.switchWorkspace(workspaceKey, { mobileNavigationIntent: "chat" });
          await switcher.updateMobileViewState?.(workspaceKey);
        }
        if (!sameWorkspace) return;
        onStartDraftInWorkspace?.(workspace.workspacePath, workspace.workspaceIdentity);
        onNavigateToChat?.();
      } catch (error) {
        const message = stringifyMobileHomeError(error);
        logger.error("[WebRemoteControlMobileTaskHome] 手机端新建任务失败", {
          error: message,
          workspaceKey,
        });
        setLoadError(message);
      } finally {
        setDraftKey(null);
        onCrossWorkspaceSwitchingChange?.(false);
      }
    },
    [
      onCrossWorkspaceSwitchingChange,
      onNavigateToChat,
      onStartDraftInWorkspace,
      switcher,
      view.activeWorkspaceKey,
    ],
  );
  const actionsLocked = switchingTaskKey !== null || draftKey !== null || reconnectKey !== null;

  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-header px-4 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-ui-lg font-medium">
              {intl.formatMessage({ id: "webRemoteControl.mobileHome.title" })}
            </div>
            <div className="mt-1 text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "webRemoteControl.mobileHome.connected" })}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <WebRemoteControlThemeMenu />
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="rounded-lg border border-card-border bg-card p-3 text-ui-base/relaxed text-foreground-subtle">
          {intl.formatMessage({ id: "webRemoteControl.mobileHome.notice" })}
        </div>
        <div className="mt-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-ui-base font-medium">
              {intl.formatMessage({ id: "webRemoteControl.mobileHome.sectionTitle" })}
            </h1>
            <p className="mt-1 text-ui-base text-foreground-subtle">
              {intl.formatMessage(
                { id: "webRemoteControl.mobileHome.summary" },
                {
                  taskCount: String(view.totalTaskCount),
                  workspaceCount: String(view.totalWorkspaceCount),
                },
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {preferences.organizeBy === "workspace" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={intl.formatMessage({ id: "webRemoteControl.mobileHome.collapseAll" })}
                onClick={() => setExpandedKeys(new Set())}
              >
                <ChevronsUp className="size-3.5" />
              </Button>
            ) : null}
            <WebRemoteControlMobileOrganizeMenu
              preferences={preferences}
              intl={intl}
              onChange={onPreferencesChange}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={intl.formatMessage({ id: "webRemoteControl.mobileHome.refresh" })}
              onClick={() => void loadWorkspaces()}
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
        {visibleError ? (
          <div className="mt-3 rounded-lg border border-destructive/40 bg-card px-3 py-2 text-ui-base text-destructive">
            {visibleError}
          </div>
        ) : null}
        {loading && view.totalWorkspaceCount === 0 ? (
          <div className="mt-3 flex items-center gap-2 px-1 py-2 text-ui-base text-foreground-subtle">
            <Loader className="size-3.5 animate-spin" />
            {intl.formatMessage({ id: "common.loading" })}
          </div>
        ) : null}
        {!loading && !visibleError && view.totalWorkspaceCount === 0 ? (
          <div className="mt-3 px-1 py-2 text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "webRemoteControl.noTasks" })}
          </div>
        ) : null}
        <WebRemoteControlMobileTaskSections
          view={view}
          timelineGroups={timelineGroups}
          workspaceByKey={workspaceByKey}
          organizeBy={preferences.organizeBy}
          sortBy={preferences.sortBy}
          expandedKeys={expandedKeys}
          reconnectKey={reconnectKey}
          draftKey={draftKey}
          actionsLocked={actionsLocked}
          reconnectAvailable={switcher.reconnectWorkspace !== undefined}
          switchingTaskKey={switchingTaskKey}
          intl={intl}
          onToggleWorkspace={(workspaceKey) => {
            setExpandedKeys((current) => {
              const next = new Set(current);
              if (next.has(workspaceKey)) next.delete(workspaceKey);
              else next.add(workspaceKey);
              return next;
            });
          }}
          onReconnect={(workspace) => void reconnectWorkspace(workspace)}
          onStartDraft={(workspace) => void startDraft(workspace)}
          onOpenTask={openDisplayedTask}
        />
      </div>
    </section>
  );
}

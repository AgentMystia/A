import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  WebRemoteControlTaskSnapshot,
  WebRemoteControlWorkspaceSnapshot,
} from "@zcode/shared";
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  FolderOpen,
  Loader,
  MessageCirclePlus,
} from "lucide-react";
import { DeleteAllArchivedTasksButton } from "@/DeleteAllArchivedTasksButton.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import { mobileTaskKey } from "@/web-remote/mobile/webRemoteControlMobileModel.js";
import type {
  WebRemoteControlMobileSortBy,
  WebRemoteControlMobileSwitcher,
  WebRemoteControlMobileWorkspaceList,
} from "@/web-remote/mobile/webRemoteControlMobileTypes.js";
import { WebRemoteControlTaskIndexRow } from "@/web-remote/task-index/WebRemoteControlTaskIndexRow.js";
import {
  loadWebRemoteTaskIndex,
  openWebRemoteIndexedTask,
} from "@/web-remote/task-index/webRemoteControlTaskIndexActions.js";
import {
  buildWebRemoteTaskIndexView,
  filterWebRemoteTaskIndexWorkspaces,
  mapWebRemoteWorkspaceServices,
  patchWebRemoteTaskMembership,
  removeWebRemoteIndexedTask,
  type WebRemoteTaskIndexViewMode,
} from "@/web-remote/task-index/webRemoteControlTaskIndexModel.js";
import { useWebRemoteTaskIndexMutations } from "@/web-remote/task-index/useWebRemoteTaskIndexMutations.js";

const EMPTY_RESULT: WebRemoteControlMobileWorkspaceList = { workspaces: [], tasks: [] };
const EMPTY_COLLAPSED_WORKSPACE_KEYS = new Set<string>();

export function WebRemoteControlTaskIndex({
  switcher,
  activeWorkspacePath,
  activeWorkspaceIdentity,
  activeTaskId,
  taskSortBy = "updated",
  taskViewMode = "workspace",
  searchQuery = "",
  collapsedWorkspaceKeys = EMPTY_COLLAPSED_WORKSPACE_KEYS,
  initialResult,
  onToggleWorkspaceCollapsed,
  onWorkspaceGroupKeysChange,
  renderBeforePinnedTasks,
  archivedActionsContainer,
  onSelectTask,
  onTaskOpen,
  onCrossWorkspaceSwitchingChange,
}: {
  switcher: WebRemoteControlMobileSwitcher;
  activeWorkspacePath: string;
  activeWorkspaceIdentity?: string;
  activeTaskId?: string | null;
  taskSortBy?: WebRemoteControlMobileSortBy;
  taskViewMode?: WebRemoteTaskIndexViewMode;
  searchQuery?: string;
  collapsedWorkspaceKeys?: Set<string>;
  initialResult?: WebRemoteControlMobileWorkspaceList;
  onToggleWorkspaceCollapsed?: (workspaceKey: string) => void;
  onWorkspaceGroupKeysChange?: (workspaceKeys: string[]) => void;
  renderBeforePinnedTasks?: () => ReactNode;
  archivedActionsContainer?: HTMLElement | null;
  onSelectTask: (workspacePath: string, taskId: string, workspaceIdentity?: string) => void;
  onTaskOpen?: (event: { crossWorkspace: boolean }) => void;
  onCrossWorkspaceSwitchingChange?: (switching: boolean) => void;
}) {
  const { intl } = useZCodeIntl();
  const confirmDialog = useConfirmDialog();
  const removeTaskState = useZCodeSessionStore((state) => state.removeTaskState);
  const sessionsById = useRemoteWorkspaceSessionStore((state) => state.sessionsById);
  const sessionIdByWorkspaceIdentity = useRemoteWorkspaceSessionStore(
    (state) => state.sessionIdByWorkspaceIdentity,
  );
  const sessionIdByWorkspacePath = useRemoteWorkspaceSessionStore(
    (state) => state.sessionIdByWorkspacePath,
  );
  const localServices = useServices();
  const sessions = useMemo(
    () => ({ sessionsById, sessionIdByWorkspaceIdentity, sessionIdByWorkspacePath }),
    [sessionIdByWorkspaceIdentity, sessionIdByWorkspacePath, sessionsById],
  );
  const [result, setResult] = useState(initialResult ?? EMPTY_RESULT);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingArchiveTaskKey, setPendingArchiveTaskKey] = useState<string | null>(null);
  const [mutatingTaskKey, setMutatingTaskKey] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [switchingTaskKey, setSwitchingTaskKey] = useState<string | null>(null);
  const activeWorkspaceKey = getWorkspaceKey(activeWorkspacePath, activeWorkspaceIdentity);
  const view = useMemo(
    () =>
      buildWebRemoteTaskIndexView({
        result,
        viewMode: taskViewMode,
        sortBy: taskSortBy,
        searchQuery,
        collapsedWorkspaceKeys,
      }),
    [collapsedWorkspaceKeys, result, searchQuery, taskSortBy, taskViewMode],
  );
  const visibleCount = view.pinnedTasks.length + view.totalTaskCount;
  const groupKeys = useMemo(() => view.groups.map((group) => group.workspaceKey), [view.groups]);
  const serviceWorkspaces = useMemo(
    () => filterWebRemoteTaskIndexWorkspaces(activeWorkspaceIdentity, result.workspaces),
    [activeWorkspaceIdentity, result.workspaces],
  );
  const servicesByWorkspace = useMemo(
    () => mapWebRemoteWorkspaceServices(serviceWorkspaces, localServices, sessions),
    [localServices, serviceWorkspaces, sessions],
  );
  const errorMessage = loadError ?? openError;

  const patchMembership = useCallback(
    (task: WebRemoteControlTaskSnapshot, membership: { pinned?: boolean; archived?: boolean }) => {
      setResult((current) => patchWebRemoteTaskMembership(current, task, membership));
    },
    [],
  );
  const removeTask = useCallback((task: WebRemoteControlTaskSnapshot) => {
    setResult((current) => removeWebRemoteIndexedTask(current, task));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void loadWebRemoteTaskIndex({
      activeTaskId,
      activeWorkspaceIdentity,
      activeWorkspacePath,
      listWorkspaces: () => switcher.listWorkspaces(),
      isCancelled: () => cancelled,
      onResult: (next) => {
        if (!cancelled) setResult(next);
      },
    }).then((outcome) => {
      if (cancelled || outcome === "cancelled") return;
      if (typeof outcome === "object") setLoadError(outcome.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTaskId, activeWorkspaceIdentity, activeWorkspacePath, switcher]);

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
    onWorkspaceGroupKeysChange?.(groupKeys);
  }, [groupKeys, onWorkspaceGroupKeysChange]);

  const { archiveTask, deleteArchivedTask, togglePin, unarchiveTask } =
    useWebRemoteTaskIndexMutations({
      confirmDialog,
      intl,
      patchMembership,
      pendingArchiveTaskKey,
      removeTask,
      removeTaskState,
      servicesByWorkspace,
      setMutatingTaskKey,
      setPendingArchiveTaskKey,
    });

  const openTask = useCallback(
    (task: WebRemoteControlTaskSnapshot) => {
      setPendingArchiveTaskKey(null);
      void openWebRemoteIndexedTask({
        activeWorkspaceIdentity,
        activeWorkspacePath,
        onSelectTask,
        onSwitchingChange: onCrossWorkspaceSwitchingChange,
        onTaskOpen,
        setError: setOpenError,
        setSwitchingTaskKey,
        switcher,
        task,
      });
    },
    [
      activeWorkspaceIdentity,
      activeWorkspacePath,
      onCrossWorkspaceSwitchingChange,
      onSelectTask,
      onTaskOpen,
      switcher,
    ],
  );

  const renderTask = useCallback(
    (task: WebRemoteControlTaskSnapshot, showWorkspaceLabel = false) => (
      <WebRemoteControlTaskIndexRow
        key={mobileTaskKey(task)}
        activeTaskId={activeTaskId}
        activeWorkspaceKey={activeWorkspaceKey}
        canMutateTask={servicesByWorkspace.has(
          getWorkspaceKey(task.workspacePath, task.workspaceIdentity),
        )}
        intl={intl}
        mutatingTaskKey={mutatingTaskKey}
        onArchiveTask={archiveTask}
        onDeleteArchivedTask={deleteArchivedTask}
        onOpenTask={openTask}
        onToggleTaskPin={togglePin}
        onUnarchiveTask={unarchiveTask}
        pendingArchiveTaskKey={pendingArchiveTaskKey}
        showWorkspaceLabel={showWorkspaceLabel}
        switchingTaskKey={switchingTaskKey}
        task={task}
        taskSortBy={taskSortBy}
      />
    ),
    [
      activeTaskId,
      activeWorkspaceKey,
      archiveTask,
      deleteArchivedTask,
      intl,
      mutatingTaskKey,
      openTask,
      pendingArchiveTaskKey,
      servicesByWorkspace,
      switchingTaskKey,
      taskSortBy,
      togglePin,
      unarchiveTask,
    ],
  );

  const archivedCount = result.tasks?.filter((task) => task.archived).length ?? 0;
  const deletionWorkspaces = result.workspaces.map((workspace) => ({
    workspacePath: workspace.workspacePath,
    workspaceIdentity: workspace.workspaceIdentity,
    label: workspace.label,
    service:
      workspace.connectionState === "disconnected" || workspace.connectionState === "reconnecting"
        ? undefined
        : servicesByWorkspace.get(
            getWorkspaceKey(workspace.workspacePath, workspace.workspaceIdentity),
          )?.services.zcodeTaskService,
  }));

  return (
    <section className="flex min-h-0 flex-col gap-2 px-2">
      {renderBeforePinnedTasks ? <div className="-mx-4">{renderBeforePinnedTasks()}</div> : null}
      {taskViewMode === "archived" ? (
        <DeleteAllArchivedTasksButton
          actionsContainer={archivedActionsContainer}
          count={archivedCount}
          disabled={loading || !result.tasks?.some((task) => task.archived)}
          workspaces={deletionWorkspaces}
          onDeleted={(target) => {
            setResult((current) =>
              removeWebRemoteIndexedTask(current, {
                ...target,
                title: "",
                workspaceLabel: "",
                workspaceKind: "local",
                createdAt: 0,
                updatedAt: 0,
              }),
            );
            removeTaskState(target.workspacePath, target.taskId, target.workspaceIdentity);
          }}
        />
      ) : null}
      {view.pinnedTasks.length > 0 ? (
        <div className="space-y-1">
          <div className="px-2 py-1 text-ui-base text-foreground-subtlest">
            {intl.formatMessage({ id: "taskList.pinnedSection" })}
          </div>
          <ul className="space-y-0.5">{view.pinnedTasks.map((task) => renderTask(task))}</ul>
        </div>
      ) : null}
      {loading && visibleCount === 0 ? (
        <div className="flex items-center gap-2 px-2 py-1 text-ui-base text-foreground-subtle">
          <Loader className="size-3.5 animate-spin" />
          {intl.formatMessage({ id: "common.loading" })}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="px-2 py-1 text-ui-base text-foreground-subtle">{errorMessage}</div>
      ) : null}
      {!loading && !errorMessage && visibleCount === 0 ? (
        <div className="px-2 py-1 text-ui-base text-foreground-subtle">
          {intl.formatMessage({
            id:
              taskViewMode === "archived" ? "taskList.noArchivedTasks" : "webRemoteControl.noTasks",
          })}
        </div>
      ) : null}
      {taskViewMode === "workspace" && view.totalTaskCount > 0 ? (
        <ul className="space-y-2">
          {view.groups.map((group) => (
            <WorkspaceGroup
              key={group.workspaceKey}
              group={group}
              intl={intl}
              onToggle={onToggleWorkspaceCollapsed}
              renderTask={renderTask}
            />
          ))}
        </ul>
      ) : null}
      {taskViewMode === "timeline" && view.timelineTasks.length > 0 ? (
        <ul className="space-y-0.5">{view.timelineTasks.map((task) => renderTask(task, true))}</ul>
      ) : null}
      {taskViewMode === "archived" && view.archivedTasks.length > 0 ? (
        <ul className="space-y-0.5 pb-4">
          {view.archivedTasks.map((task) => renderTask(task, true))}
        </ul>
      ) : null}
    </section>
  );
}

function WorkspaceGroup({
  group,
  intl,
  onToggle,
  renderTask,
}: {
  group: ReturnType<typeof buildWebRemoteTaskIndexView>["groups"][number];
  intl: { formatMessage: (descriptor: { id: string }) => string };
  onToggle?: (workspaceKey: string) => void;
  renderTask: (task: WebRemoteControlTaskSnapshot) => ReactNode;
}) {
  const workspace = group.workspace;
  const label =
    workspace.workspacePurpose === "conversation"
      ? intl.formatMessage({ id: "workspaceSidebar.conversationsSection" })
      : workspace.label;
  return (
    <li className="space-y-1">
      <button
        type="button"
        className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg pl-2.5 pr-1 text-left text-foreground hover:bg-surface-hover hover:text-foreground"
        aria-expanded={!group.collapsed}
        onClick={() => onToggle?.(group.workspaceKey)}
      >
        <span className="flex size-3 shrink-0 items-center justify-center text-foreground-subtlest">
          {group.collapsed ? (
            <ChevronRight className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
        </span>
        <span className="flex size-4 shrink-0 items-center justify-center text-foreground-subtle">
          <WorkspaceKindIcon workspace={workspace} />
        </span>
        <span className="min-w-0 flex-1 truncate text-ui-base text-foreground-subtle">{label}</span>
        {group.collapsed && group.hasUnread ? (
          <span
            aria-hidden="true"
            data-workspace-unread-indicator="true"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500 dark:bg-sky-400"
          />
        ) : null}
        <span className="shrink-0 text-ui-base text-foreground-subtlest">
          {group.totalTaskCount}
        </span>
      </button>
      {group.collapsed ? null : (
        <ul className="space-y-0.5">{group.tasks.map((task) => renderTask(task))}</ul>
      )}
    </li>
  );
}

function WorkspaceKindIcon({ workspace }: { workspace: WebRemoteControlWorkspaceSnapshot }) {
  if (workspace.workspacePurpose === "conversation") {
    return <MessageCirclePlus className="size-4" />;
  }
  if (workspace.kind === "remote") return <Cloud className="size-4" />;
  return <FolderOpen className="size-4" />;
}

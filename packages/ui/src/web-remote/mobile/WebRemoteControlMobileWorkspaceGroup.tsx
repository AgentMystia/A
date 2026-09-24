import {
  ChevronDown,
  ChevronRight,
  Cloud,
  FolderOpen,
  Loader,
  MessageCirclePlus,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  testId,
  TID_TASK_ITEM,
  type WebRemoteControlTaskSnapshot,
  type WebRemoteControlWorkspaceSnapshot,
} from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { TaskWorkflowRunLines } from "@/components/workflow-run-line/TaskWorkflowRunLines.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import {
  mobileTaskStatusClass,
  mobileTaskStatusIcon,
} from "@/web-remote/mobile/webRemoteControlMobileTaskStatus.js";
import {
  isRemoteWorkspaceDisconnected,
  latestTaskUpdatedAt,
  mobileTaskKey,
  type MobileTaskWorkspaceGroup,
} from "@/web-remote/mobile/webRemoteControlMobileModel.js";

interface IntlLike {
  formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => string;
}

export function WebRemoteControlMobileWorkspaceGroup({
  group,
  expanded,
  reconnecting,
  startingDraft,
  actionsLocked,
  switchingTaskKey,
  activeWorkspaceKey,
  activeTaskId,
  reconnectDisabled,
  intl,
  onToggle,
  onReconnect,
  onStartDraft,
  onOpenTask,
}: {
  group: MobileTaskWorkspaceGroup;
  expanded: boolean;
  reconnecting: boolean;
  startingDraft: boolean;
  actionsLocked: boolean;
  switchingTaskKey: string | null;
  activeWorkspaceKey: string;
  activeTaskId: string | null;
  reconnectDisabled: boolean;
  intl: IntlLike;
  onToggle: (workspaceKey: string) => void;
  onReconnect: (workspace: WebRemoteControlWorkspaceSnapshot) => void;
  onStartDraft: (workspace: WebRemoteControlWorkspaceSnapshot) => void;
  onOpenTask: (task: WebRemoteControlTaskSnapshot) => void;
}) {
  const disconnected = isRemoteWorkspaceDisconnected(group.workspace);
  const updatedAt = latestTaskUpdatedAt(group.tasks);
  const conversation = group.workspace.workspacePurpose === "conversation";
  const kindId = conversation
    ? "webRemoteControl.mobileHome.workspaceKind.conversation"
    : group.workspace.kind === "remote"
      ? "webRemoteControl.mobileHome.workspaceKind.remote"
      : "webRemoteControl.mobileHome.workspaceKind.local";

  return (
    <li className="rounded-lg border border-card-border bg-card">
      <div className="flex min-w-0 items-center gap-2 px-3 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
          onClick={() => onToggle(group.workspaceKey)}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-foreground-subtle">
            {conversation ? (
              <MessageCirclePlus className="size-4" />
            ) : group.workspace.kind === "remote" ? (
              <Cloud className="size-4" />
            ) : (
              <FolderOpen className="size-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-ui-base font-medium text-foreground">
                {conversation
                  ? intl.formatMessage({ id: "workspaceSidebar.conversationsSection" })
                  : group.workspace.label}
              </span>
              <span className="shrink-0 rounded-full border border-border bg-surface px-1.5 py-0.5 text-ui-xs leading-none text-foreground-subtle">
                {intl.formatMessage({ id: kindId })}
              </span>
              {disconnected ? (
                <span className="shrink-0 rounded-full border border-destructive/40 bg-card px-1.5 py-0.5 text-ui-xs leading-none text-destructive">
                  {intl.formatMessage({ id: "webRemoteControl.mobileHome.disconnected" })}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block truncate font-mono text-ui-base text-foreground-subtlest">
              {group.workspace.workspacePath}
            </span>
            {group.workspace.lastConnectionError ? (
              <span className="mt-1 block truncate text-ui-base text-destructive">
                {group.workspace.lastConnectionError}
              </span>
            ) : null}
            {updatedAt ? (
              <span className="mt-1 block text-ui-base text-foreground-subtle">
                {intl.formatMessage(
                  { id: "webRemoteControl.mobileHome.updatedAt" },
                  { time: formatTaskRelativeTime(updatedAt, intl) },
                )}
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-ui-base text-foreground-subtle">
            {!expanded && group.hasUnread ? (
              <span
                aria-hidden="true"
                data-workspace-unread-indicator="true"
                className="h-1.5 w-1.5 rounded-full bg-sky-500 dark:bg-sky-400"
              />
            ) : null}
            {intl.formatMessage(
              { id: "webRemoteControl.mobileHome.taskCount" },
              { count: String(group.tasks.length) },
            )}
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </span>
        </button>
        {disconnected ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={reconnectDisabled}
            onClick={() => onReconnect(group.workspace)}
          >
            {reconnecting ? (
              <Loader className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            <span className="sr-only">
              {intl.formatMessage({
                id: reconnecting
                  ? "webRemoteControl.mobileHome.reconnecting"
                  : "webRemoteControl.mobileHome.reconnect",
              })}
            </span>
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={actionsLocked}
            onClick={() => onStartDraft(group.workspace)}
          >
            {startingDraft ? (
              <Loader className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
          </Button>
        )}
      </div>
      {expanded ? (
        <ul className="border-t border-card-border px-2 py-2">
          {group.tasks.length === 0 ? (
            <li className="px-2 py-2 text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "webRemoteControl.mobileHome.workspaceEmpty" })}
            </li>
          ) : null}
          {group.tasks.map((task) => {
            const taskKey = mobileTaskKey(task);
            const selected =
              getWorkspaceKey(task.workspacePath, task.workspaceIdentity) === activeWorkspaceKey &&
              task.taskId === activeTaskId;
            const switching = switchingTaskKey === taskKey;
            const title = task.title || intl.formatMessage({ id: "taskList.untitled" });
            const status = task.displayStatus ?? "idle";
            return (
              <li key={taskKey}>
                <button
                  type="button"
                  data-testid={testId(TID_TASK_ITEM, task.taskId)}
                  data-state={selected ? "selected" : "idle"}
                  className={cn(
                    "flex min-h-12 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors disabled:cursor-wait disabled:opacity-70",
                    selected ? "bg-selected text-foreground" : "hover:bg-surface-hover",
                  )}
                  disabled={switchingTaskKey !== null || disconnected}
                  onClick={() => {
                    if (!disconnected) onOpenTask(task);
                  }}
                >
                  <span className="relative flex size-4 shrink-0 items-center justify-center">
                    {switching ? (
                      <Loader className="size-4 animate-spin text-foreground-subtle" />
                    ) : task.unreadAt ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-500 dark:bg-sky-400" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui-base text-foreground">{title}</span>
                    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-ui-base text-foreground-subtle">
                      <span className="truncate">{formatTaskRelativeTime(task.updatedAt, intl)}</span>
                    </span>
                    {task.workflowActivity ? (
                      <TaskWorkflowRunLines
                        activity={task.workflowActivity}
                        isActive={selected}
                        intl={intl}
                        density="compact"
                      />
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-ui-xs leading-none",
                      mobileTaskStatusClass(status),
                    )}
                  >
                    {mobileTaskStatusIcon(status)}
                    {intl.formatMessage({ id: `webRemoteControl.taskStatus.${status}` })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

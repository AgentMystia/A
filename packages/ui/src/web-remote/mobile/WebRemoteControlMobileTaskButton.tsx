import type {
  WebRemoteControlTaskSnapshot,
  WebRemoteControlWorkspaceSnapshot,
} from "@zcode/shared";
import { testId, TID_TASK_ITEM } from "@zcode/shared";
import { CircleAlert, CircleCheck, Loader, Pin } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";
import { TaskWorkflowRunLines } from "@/components/workflow-run-line/TaskWorkflowRunLines.js";
import { mobileTaskKey } from "@/web-remote/mobile/webRemoteControlMobileModel.js";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import type { WebRemoteControlMobileSortBy } from "@/web-remote/mobile/webRemoteControlMobileTypes.js";

type TaskRowVariant = "pinned" | "timeline" | "workspace";

interface IntlLike {
  formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => string;
}

function taskStatusClass(
  status: NonNullable<WebRemoteControlTaskSnapshot["displayStatus"]>,
): string {
  switch (status) {
    case "running":
      return "border-brand/40 bg-accent text-foreground";
    case "completed":
      return "border-success/40 bg-success text-success-foreground";
    case "error":
      return "border-destructive/40 bg-destructive text-destructive-foreground";
    case "idle":
      return "border-border bg-surface text-foreground-subtle";
  }
}

function TaskStatusIcon({
  status,
}: {
  status: NonNullable<WebRemoteControlTaskSnapshot["displayStatus"]>;
}) {
  if (status === "running") return <Loader className="size-3 animate-spin" />;
  if (status === "completed") return <CircleCheck className="size-3" />;
  if (status === "error") return <CircleAlert className="size-3" />;
  return null;
}

export function WebRemoteControlMobileTaskButton({
  task,
  workspace,
  activeWorkspaceKey,
  activeTaskId,
  switchingTaskKey,
  disconnected,
  variant,
  sortBy,
  intl,
  onOpen,
}: {
  task: WebRemoteControlTaskSnapshot;
  workspace?: WebRemoteControlWorkspaceSnapshot;
  activeWorkspaceKey: string;
  activeTaskId: string | null;
  switchingTaskKey: string | null;
  disconnected: boolean;
  variant: TaskRowVariant;
  sortBy: WebRemoteControlMobileSortBy;
  intl: IntlLike;
  onOpen: (task: WebRemoteControlTaskSnapshot) => void;
}) {
  const taskKey = mobileTaskKey(task);
  const selected =
    getWorkspaceKey(task.workspacePath, task.workspaceIdentity) === activeWorkspaceKey &&
    task.taskId === activeTaskId;
  const switching = switchingTaskKey === taskKey;
  const title = task.title || intl.formatMessage({ id: "taskList.untitled" });
  const status = task.displayStatus ?? "idle";
  const timestamp =
    variant === "workspace" || sortBy === "updated" ? task.updatedAt : task.createdAt;
  const workspaceLabel =
    workspace?.workspacePurpose === "conversation"
      ? intl.formatMessage({ id: "workspaceSidebar.conversationsSection" })
      : task.workspaceLabel || workspace?.label || task.workspacePath;
  const bordered = variant !== "workspace";

  return (
    <li>
      <button
        type="button"
        data-testid={testId(TID_TASK_ITEM, task.taskId)}
        data-state={selected ? "selected" : "idle"}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 text-left transition-colors disabled:cursor-wait disabled:opacity-70",
          variant === "timeline" ? "min-h-14" : "min-h-12",
          bordered
            ? "rounded-lg border border-card-border bg-card px-3 py-2"
            : "rounded-lg px-2.5 py-2",
          selected ? "bg-selected text-foreground" : "hover:bg-surface-hover",
        )}
        disabled={switchingTaskKey !== null || disconnected}
        onClick={() => {
          if (!disconnected) onOpen(task);
        }}
        aria-label={intl.formatMessage({ id: "webRemoteControl.openTask" }, { title })}
      >
        <span
          className={cn(
            "relative flex size-4 shrink-0 items-center justify-center",
            variant === "pinned" && "text-foreground-subtle",
          )}
        >
          {switching ? (
            <Loader className="size-4 animate-spin text-foreground-subtle" />
          ) : variant === "pinned" ? (
            <Pin className="size-4" />
          ) : null}
          {!switching && task.unreadAt ? (
            <span
              className={cn(
                "rounded-full bg-sky-500 dark:bg-sky-400",
                variant === "pinned" ? "absolute -top-0.5 -right-0.5 h-1.5 w-1.5" : "h-1.5 w-1.5",
              )}
            />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui-base text-foreground">{title}</span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-ui-base text-foreground-subtle">
            {variant === "workspace" ? (
              <span className="truncate">{formatTaskRelativeTime(timestamp, intl)}</span>
            ) : (
              <>
                <span className="truncate">{workspaceLabel}</span>
                <span className="shrink-0">·</span>
                <span className="truncate">{formatTaskRelativeTime(timestamp, intl)}</span>
              </>
            )}
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
            taskStatusClass(status),
          )}
        >
          <TaskStatusIcon status={status} />
          {intl.formatMessage({ id: `webRemoteControl.taskStatus.${status}` })}
        </span>
      </button>
    </li>
  );
}

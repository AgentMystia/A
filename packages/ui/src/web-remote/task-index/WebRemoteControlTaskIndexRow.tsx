import { useCallback, useState, type MouseEvent } from "react";
import type { WebRemoteControlTaskSnapshot } from "@zcode/shared";
import { testId, TID_TASK_ARCHIVE, TID_TASK_ITEM } from "@zcode/shared";
import { Archive, ArchiveX, CloudDownload, Loader, Pin, Trash2 } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";
import { TaskWorkflowRunLines } from "@/components/workflow-run-line/TaskWorkflowRunLines.js";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import { mobileTaskKey } from "@/web-remote/mobile/webRemoteControlMobileModel.js";
import type { WebRemoteControlMobileSortBy } from "@/web-remote/mobile/webRemoteControlMobileTypes.js";

interface TaskIndexIntl {
  formatMessage: (descriptor: { id: string }, values?: Record<string, string | number>) => string;
}

export function WebRemoteControlTaskIndexRow({
  activeTaskId,
  activeWorkspaceKey,
  canMutateTask,
  intl,
  mutatingTaskKey,
  onArchiveTask,
  onDeleteArchivedTask,
  onOpenTask,
  onToggleTaskPin,
  onUnarchiveTask,
  pendingArchiveTaskKey,
  showWorkspaceLabel = false,
  switchingTaskKey,
  task,
  taskSortBy,
}: {
  activeTaskId?: string | null;
  activeWorkspaceKey: string;
  canMutateTask: boolean;
  intl: TaskIndexIntl;
  mutatingTaskKey: string | null;
  onArchiveTask: (event: MouseEvent, task: WebRemoteControlTaskSnapshot) => void;
  onDeleteArchivedTask: (event: MouseEvent, task: WebRemoteControlTaskSnapshot) => void;
  onOpenTask: (task: WebRemoteControlTaskSnapshot) => void;
  onToggleTaskPin: (event: MouseEvent, task: WebRemoteControlTaskSnapshot) => void;
  onUnarchiveTask: (event: MouseEvent, task: WebRemoteControlTaskSnapshot) => void;
  pendingArchiveTaskKey: string | null;
  showWorkspaceLabel?: boolean;
  switchingTaskKey: string | null;
  task: WebRemoteControlTaskSnapshot;
  taskSortBy: WebRemoteControlMobileSortBy;
}) {
  const [hovered, setHovered] = useState(false);
  const taskKey = mobileTaskKey(task);
  const selected =
    getWorkspaceKey(task.workspacePath, task.workspaceIdentity) === activeWorkspaceKey &&
    task.taskId === activeTaskId;
  const switching = switchingTaskKey === taskKey;
  const mutating = mutatingTaskKey === taskKey;
  const pendingArchive = pendingArchiveTaskKey === taskKey;
  const canPin = canMutateTask && !task.archived;
  const canArchive = canMutateTask && !task.archived;
  const canUnarchive = canMutateTask && Boolean(task.archived);
  const canDelete = canMutateTask && Boolean(task.archived);
  const showPinnedIcon = Boolean(task.pinned && !task.archived);
  const anySwitching = Boolean(switchingTaskKey);
  const showPinAction = canPin && hovered;
  const showArchiveAction = canArchive && (hovered || pendingArchive);
  const showArchivedActions = (canUnarchive || canDelete) && hovered;
  const title = task.title || intl.formatMessage({ id: "taskList.untitled" });
  const timestamp = formatTaskRelativeTime(
    taskSortBy === "created" ? task.createdAt : task.updatedAt,
    intl,
  );
  const pinLabel = intl.formatMessage({ id: task.pinned ? "taskList.unpin" : "taskList.pin" });
  const archiveLabel = intl.formatMessage({
    id: pendingArchive ? "common.confirm" : "taskList.archive",
  });
  const unarchiveLabel = intl.formatMessage({ id: "taskList.unarchive" });
  const deleteLabel = intl.formatMessage({ id: "taskList.delete" });
  const isRemoteTask = Boolean(task.workspaceIdentity?.trim() || task.workspaceKind === "remote");
  const showLeading = useCallback(() => setHovered(true), []);
  const hideLeading = useCallback(() => setHovered(false), []);

  return (
    <li
      data-web-remote-task-row={taskKey}
      onMouseEnter={showLeading}
      onMouseLeave={hideLeading}
      className={cn(
        "group/task-item relative flex w-full cursor-pointer items-center gap-2 rounded-lg text-left transition-[background-color,border-color,box-shadow]",
        anySwitching && "cursor-wait opacity-80",
        selected ? "bg-selected" : "hover:bg-surface-hover",
      )}
    >
      <button
        type="button"
        aria-label={intl.formatMessage({ id: "webRemoteControl.openTask" }, { title })}
        data-testid={testId(TID_TASK_ITEM, task.taskId)}
        disabled={anySwitching}
        onClick={() => onOpenTask(task)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 pl-2.5 pr-1 text-left disabled:cursor-wait disabled:opacity-80"
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          <span
            aria-hidden="true"
            className={cn(
              "flex size-4 items-center justify-center transition-opacity",
              showPinAction && "hidden",
            )}
          >
            {switching || mutating ? (
              <Loader className="size-4 animate-spin text-foreground-subtle" />
            ) : task.unreadAt ? (
              <span
                data-unread-indicator="true"
                className="h-1.5 w-1.5 rounded-full bg-sky-500 dark:bg-sky-400"
              />
            ) : showPinnedIcon ? (
              <Pin className="size-4 text-foreground-subtle" />
            ) : null}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="min-w-0 flex h-6 flex-wrap items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-ui-base text-foreground" title={title}>
              {title}
            </span>
            {showWorkspaceLabel ? (
              <span
                className="max-w-28 shrink truncate text-ui-base text-foreground-subtlest"
                title={task.workspaceLabel}
              >
                {task.workspaceLabel}
              </span>
            ) : null}
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
            "mr-0.5 shrink-0 text-ui-base text-foreground-subtle",
            showArchiveAction && "hidden",
          )}
        >
          {timestamp}
        </span>
      </button>
      {showPinAction ? (
        <ControlHintTooltip title={pinLabel} side="right" align="center">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={anySwitching || mutating}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => onToggleTaskPin(event, task)}
            className="absolute left-2.5 top-1/2 z-10 inline-flex size-4 min-w-0 -translate-y-1/2 rounded-sm !bg-transparent p-0 text-foreground-subtle hover:text-foreground"
            aria-label={pinLabel}
          >
            <Pin className="size-4" />
          </Button>
        </ControlHintTooltip>
      ) : null}
      {showArchiveAction ? (
        <ControlHintTooltip title={archiveLabel} side="right" align="center">
          <Button
            type="button"
            variant={pendingArchive ? "destructive" : "ghost"}
            size={pendingArchive ? "sm" : "icon-sm"}
            disabled={anySwitching || mutating}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => onArchiveTask(event, task)}
            data-testid={testId(TID_TASK_ARCHIVE, task.taskId)}
            className={cn("shrink-0", pendingArchive ? "flex border-destructive/20 px-2" : "flex")}
            aria-label={archiveLabel}
          >
            {pendingArchive ? (
              <span>{intl.formatMessage({ id: "common.confirm" })}</span>
            ) : (
              <Archive className="size-3.5" />
            )}
          </Button>
        </ControlHintTooltip>
      ) : null}
      {showArchivedActions ? (
        <>
          {canUnarchive ? (
            <ControlHintTooltip title={unarchiveLabel} side="right" align="center">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={anySwitching || mutating}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => onUnarchiveTask(event, task)}
                className="shrink-0 text-foreground-subtle hover:text-foreground"
                aria-label={unarchiveLabel}
              >
                {isRemoteTask ? (
                  <CloudDownload className="size-3.5" />
                ) : (
                  <ArchiveX className="size-3.5" />
                )}
              </Button>
            </ControlHintTooltip>
          ) : null}
          {canDelete ? (
            <ControlHintTooltip title={deleteLabel} side="right" align="center">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={anySwitching || mutating}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => onDeleteArchivedTask(event, task)}
                className="shrink-0 text-destructive hover:text-destructive"
                aria-label={deleteLabel}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </ControlHintTooltip>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

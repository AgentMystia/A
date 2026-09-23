import type {
  WebRemoteControlTaskSnapshot,
  WebRemoteControlWorkspaceSnapshot,
} from "@zcode/shared";
import { testId, TID_TASK_ITEM } from "@zcode/shared";
import { Loader, Pin } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { TaskWorkflowRunLines } from "@/components/workflow-run-line/TaskWorkflowRunLines.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";
import { getTaskTimelineGroupMessage } from "@/lib/taskTimelineGroups.js";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import { WebRemoteControlMobileWorkspaceGroup } from "@/web-remote/mobile/WebRemoteControlMobileWorkspaceGroup.js";
import {
  isRemoteWorkspaceDisconnected,
  mobileTaskKey,
  type MobileTaskHomeView,
} from "@/web-remote/mobile/webRemoteControlMobileModel.js";
import {
  mobileTaskStatusClass,
  mobileTaskStatusIcon,
} from "@/web-remote/mobile/webRemoteControlMobileTaskStatus.js";
import type { WebRemoteControlMobileSortBy } from "@/web-remote/mobile/webRemoteControlMobileTypes.js";

interface IntlLike {
  formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => string;
}

interface TimelineGroup {
  key: string;
  label: Parameters<typeof getTaskTimelineGroupMessage>[0];
  items: WebRemoteControlTaskSnapshot[];
}

export function WebRemoteControlMobileTaskSections({
  view,
  timelineGroups,
  workspaceByKey,
  organizeBy,
  sortBy,
  expandedKeys,
  reconnectKey,
  draftKey,
  actionsLocked,
  reconnectAvailable,
  switchingTaskKey,
  intl,
  onToggleWorkspace,
  onReconnect,
  onStartDraft,
  onOpenTask,
}: {
  view: MobileTaskHomeView;
  timelineGroups: TimelineGroup[];
  workspaceByKey: Map<string, WebRemoteControlWorkspaceSnapshot>;
  organizeBy: "workspace" | "timeline";
  sortBy: WebRemoteControlMobileSortBy;
  expandedKeys: Set<string>;
  reconnectKey: string | null;
  draftKey: string | null;
  actionsLocked: boolean;
  reconnectAvailable: boolean;
  switchingTaskKey: string | null;
  intl: IntlLike;
  onToggleWorkspace: (workspaceKey: string) => void;
  onReconnect: (workspace: WebRemoteControlWorkspaceSnapshot) => void;
  onStartDraft: (workspace: WebRemoteControlWorkspaceSnapshot) => void;
  onOpenTask: (task: WebRemoteControlTaskSnapshot) => void;
}) {
  const workspaceFor = (task: WebRemoteControlTaskSnapshot) =>
    workspaceByKey.get(getWorkspaceKey(task.workspacePath, task.workspaceIdentity));

  return (
    <>
      {view.pinnedTasks.length > 0 ? (
        <section className="mt-3">
          <h2 className="px-1 py-1 text-ui-base font-medium text-foreground-subtlest">
            {intl.formatMessage({ id: "taskList.pinnedSection" })}
          </h2>
          <ul className="space-y-1">
            {view.pinnedTasks.map((task) => {
              const workspace = workspaceFor(task);
              const disconnected = isRemoteWorkspaceDisconnected(workspace);
              const taskKey = mobileTaskKey(task);
              const selected =
                getWorkspaceKey(task.workspacePath, task.workspaceIdentity) ===
                  view.activeWorkspaceKey && task.taskId === view.activeTaskId;
              const switching = switchingTaskKey === taskKey;
              const title = task.title || intl.formatMessage({ id: "taskList.untitled" });
              const status = task.displayStatus ?? "idle";
              const timestamp = sortBy === "created" ? task.createdAt : task.updatedAt;
              const workspaceLabel =
                workspace?.workspacePurpose === "conversation"
                  ? intl.formatMessage({ id: "workspaceSidebar.conversationsSection" })
                  : task.workspaceLabel || workspace?.label || task.workspacePath;
              return (
                <li key={taskKey}>
                  <button
                    type="button"
                    data-testid={testId(TID_TASK_ITEM, task.taskId)}
                    data-state={selected ? "selected" : "idle"}
                    className={cn(
                      "flex min-h-12 w-full min-w-0 items-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-left transition-colors disabled:cursor-wait disabled:opacity-70",
                      selected ? "bg-selected text-foreground" : "hover:bg-surface-hover",
                    )}
                    disabled={switchingTaskKey !== null || disconnected}
                    onClick={() => {
                      if (!disconnected) onOpenTask(task);
                    }}
                    aria-label={intl.formatMessage({ id: "webRemoteControl.openTask" }, { title })}
                  >
                    <span className="relative flex size-4 shrink-0 items-center justify-center text-foreground-subtle">
                      {switching ? (
                        <Loader className="size-4 animate-spin" />
                      ) : (
                        <Pin className="size-4" />
                      )}
                      {!switching && task.unreadAt ? (
                        <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-sky-500 dark:bg-sky-400" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui-base text-foreground">{title}</span>
                      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-ui-base text-foreground-subtle">
                        <span className="truncate">{workspaceLabel}</span>
                        <span className="shrink-0">·</span>
                        <span className="truncate">{formatTaskRelativeTime(timestamp, intl)}</span>
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
        </section>
      ) : null}
      {organizeBy === "timeline" ? (
        <ul className="mt-3 space-y-2">
          {view.totalTaskCount === 0 && view.totalWorkspaceCount > 0 ? (
            <li className="px-1 py-2 text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "webRemoteControl.noTasks" })}
            </li>
          ) : null}
          {timelineGroups.map((group) => {
            const label = getTaskTimelineGroupMessage(group.label);
            return (
              <li key={group.key} className="space-y-1">
                <div className="px-1 py-1 text-ui-base font-medium text-foreground-subtle">
                  {intl.formatMessage({ id: label.id }, label.values)}
                </div>
                <ul className="space-y-1">
                  {group.items.map((task) => {
                    const workspace = workspaceFor(task);
                    const disconnected = isRemoteWorkspaceDisconnected(workspace);
                    const taskKey = mobileTaskKey(task);
                    const selected =
                      getWorkspaceKey(task.workspacePath, task.workspaceIdentity) ===
                        view.activeWorkspaceKey && task.taskId === view.activeTaskId;
                    const switching = switchingTaskKey === taskKey;
                    const title = task.title || intl.formatMessage({ id: "taskList.untitled" });
                    const status = task.displayStatus ?? "idle";
                    const timestamp = sortBy === "created" ? task.createdAt : task.updatedAt;
                    const workspaceLabel =
                      workspace?.workspacePurpose === "conversation"
                        ? intl.formatMessage({ id: "workspaceSidebar.conversationsSection" })
                        : task.workspaceLabel || workspace?.label || task.workspacePath;
                    return (
                      <li key={taskKey}>
                        <button
                          type="button"
                          data-testid={testId(TID_TASK_ITEM, task.taskId)}
                          data-state={selected ? "selected" : "idle"}
                          className={cn(
                            "flex min-h-14 w-full min-w-0 items-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-left transition-colors disabled:cursor-wait disabled:opacity-70",
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
                            <span className="block truncate text-ui-base text-foreground">
                              {title}
                            </span>
                            <span className="mt-1 flex min-w-0 items-center gap-1.5 text-ui-base text-foreground-subtle">
                              <span className="truncate">{workspaceLabel}</span>
                              <span className="shrink-0">·</span>
                              <span className="truncate">
                                {formatTaskRelativeTime(timestamp, intl)}
                              </span>
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
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="mt-3 space-y-2">
          {view.groups.map((group) => (
            <WebRemoteControlMobileWorkspaceGroup
              key={group.workspaceKey}
              group={group}
              expanded={expandedKeys.has(group.workspaceKey)}
              reconnecting={reconnectKey === group.workspaceKey}
              startingDraft={draftKey === group.workspaceKey}
              actionsLocked={actionsLocked}
              switchingTaskKey={switchingTaskKey}
              activeWorkspaceKey={view.activeWorkspaceKey}
              activeTaskId={view.activeTaskId}
              reconnectDisabled={!reconnectAvailable || actionsLocked}
              intl={intl}
              onToggle={onToggleWorkspace}
              onReconnect={onReconnect}
              onStartDraft={onStartDraft}
              onOpenTask={onOpenTask}
            />
          ))}
        </ul>
      )}
    </>
  );
}

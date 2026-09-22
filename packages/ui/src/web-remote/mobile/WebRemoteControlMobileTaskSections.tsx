import type {
  WebRemoteControlTaskSnapshot,
  WebRemoteControlWorkspaceSnapshot,
} from "@zcode/shared";
import { getTaskTimelineGroupMessage } from "@/lib/taskTimelineGroups.js";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import { WebRemoteControlMobileTaskButton } from "@/web-remote/mobile/WebRemoteControlMobileTaskButton.js";
import { WebRemoteControlMobileWorkspaceGroup } from "@/web-remote/mobile/WebRemoteControlMobileWorkspaceGroup.js";
import {
  isRemoteWorkspaceDisconnected,
  mobileTaskKey,
  type MobileTaskHomeView,
} from "@/web-remote/mobile/webRemoteControlMobileModel.js";
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
            {view.pinnedTasks.map((task) => (
              <WebRemoteControlMobileTaskButton
                key={mobileTaskKey(task)}
                task={task}
                workspace={workspaceFor(task)}
                variant="pinned"
                disconnected={isRemoteWorkspaceDisconnected(workspaceFor(task))}
                activeWorkspaceKey={view.activeWorkspaceKey}
                activeTaskId={view.activeTaskId}
                switchingTaskKey={switchingTaskKey}
                sortBy={sortBy}
                intl={intl}
                onOpen={onOpenTask}
              />
            ))}
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
                  {group.items.map((task) => (
                    <WebRemoteControlMobileTaskButton
                      key={mobileTaskKey(task)}
                      task={task}
                      workspace={workspaceFor(task)}
                      variant="timeline"
                      disconnected={isRemoteWorkspaceDisconnected(workspaceFor(task))}
                      activeWorkspaceKey={view.activeWorkspaceKey}
                      activeTaskId={view.activeTaskId}
                      switchingTaskKey={switchingTaskKey}
                      sortBy={sortBy}
                      intl={intl}
                      onOpen={onOpenTask}
                    />
                  ))}
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

import type {
  WebRemoteControlTaskSnapshot,
  WebRemoteControlWorkspaceSnapshot,
  ZCodeTaskMeta,
  ZCodeTaskRuntimeStatus,
} from "@zcode/shared";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import { isWorkspaceTab, type WindowTabState, type WorkspaceTabState } from "@/store/tabStore.js";
import { getTaskListRowActivity } from "@/v4/taskListRowActivity.js";

export function canSyncWebRemoteControlTasks(input: {
  enabled: boolean;
  archivedLoading: boolean;
  pinnedLoading: boolean;
  timelineLoading: boolean;
}): boolean {
  return !(!input.enabled || input.archivedLoading || input.pinnedLoading || input.timelineLoading);
}

interface TaskRuntimeWorkspace {
  taskRuntimeByTaskId?: Readonly<Record<string, { status?: ZCodeTaskRuntimeStatus } | undefined>>;
}

export function buildWebRemoteControlTaskSyncSnapshot(input: {
  workspaceTabs: readonly WorkspaceTabState[];
  workspaces: Readonly<Record<string, TaskRuntimeWorkspace | undefined>>;
  pinnedTasks: readonly ZCodeTaskMeta[];
  timelineTasks: readonly ZCodeTaskMeta[];
  archivedTasks: readonly ZCodeTaskMeta[];
}): WebRemoteControlTaskSnapshot[] {
  const runtimeByWorkspaceKey = Object.fromEntries(
    Object.entries(input.workspaces).map(([workspaceKey, workspace]) => [
      workspaceKey,
      workspace?.taskRuntimeByTaskId,
    ]),
  );
  const pinned = projectTasks({
    workspaceTabs: input.workspaceTabs,
    tasks: input.pinnedTasks,
    runtimeByWorkspaceKey,
    pinned: true,
  });
  const timeline = projectTasks({
    workspaceTabs: input.workspaceTabs,
    tasks: input.timelineTasks,
    runtimeByWorkspaceKey,
  });
  const archived = projectTasks({
    workspaceTabs: input.workspaceTabs,
    tasks: input.archivedTasks,
    runtimeByWorkspaceKey,
    archived: true,
  });
  return [...pinned, ...timeline, ...archived].sort(compareMergedTaskSnapshots);
}

export function resolveWebRemoteControlWorkspaceSyncPayloads(input: {
  tabs: readonly WindowTabState[];
  reconnectingRemoteWorkspaceKeys?: readonly string[];
  remoteWorkspaceErrorByWorkspaceKey?: Readonly<Record<string, string>>;
  featureEnabled: boolean;
  sessionActive: boolean;
}): WebRemoteControlWorkspaceSnapshot[][] {
  const payloads: WebRemoteControlWorkspaceSnapshot[][] = [];
  const connectedRemote = buildConnectedRemoteWorkspaceSnapshots(input.tabs);
  if (connectedRemote.length > 0) {
    payloads.push(connectedRemote);
  }
  if (!input.featureEnabled || !input.sessionActive) {
    return payloads;
  }
  payloads.push(
    buildWebRemoteControlWorkspaceSnapshots({
      tabs: input.tabs,
      reconnectingRemoteWorkspaceKeys: input.reconnectingRemoteWorkspaceKeys,
      remoteWorkspaceErrorByWorkspaceKey: input.remoteWorkspaceErrorByWorkspaceKey,
    }),
  );
  return payloads;
}

function buildConnectedRemoteWorkspaceSnapshots(
  tabs: readonly WindowTabState[],
): WebRemoteControlWorkspaceSnapshot[] {
  return tabs
    .filter(isWorkspaceTab)
    .filter((tab) => tab.remoteSessionId && tab.workspaceIdentity)
    .map((tab) => ({
      workspacePath: tab.workspacePath,
      label: tab.label,
      kind: "remote" as const,
      connectionState: "connected" as const,
      workspaceIdentity: tab.workspaceIdentity!,
      remoteSessionId: tab.remoteSessionId!,
    }));
}

function buildWebRemoteControlWorkspaceSnapshots(input: {
  tabs: readonly WindowTabState[];
  reconnectingRemoteWorkspaceKeys?: readonly string[];
  remoteWorkspaceErrorByWorkspaceKey?: Readonly<Record<string, string>>;
}): WebRemoteControlWorkspaceSnapshot[] {
  const reconnecting = new Set(input.reconnectingRemoteWorkspaceKeys ?? []);
  const errors = input.remoteWorkspaceErrorByWorkspaceKey ?? {};
  return input.tabs.filter(isWorkspaceTab).map((tab) => {
    const remote = Boolean(tab.workspaceIdentity || tab.remoteTarget || tab.remoteSessionId);
    const workspaceKey = tab.workspaceIdentity?.trim() || tab.workspacePath;
    const lastConnectionError = errors[workspaceKey]?.trim();
    return {
      workspacePath: tab.workspacePath,
      label: tab.label,
      kind: remote ? ("remote" as const) : ("local" as const),
      ...(remote
        ? {
            connectionState: reconnecting.has(workspaceKey)
              ? ("reconnecting" as const)
              : tab.remoteSessionId
                ? ("connected" as const)
                : ("disconnected" as const),
          }
        : {}),
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      ...(tab.workspacePurpose ? { workspacePurpose: tab.workspacePurpose } : {}),
      ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
      ...(remote && lastConnectionError ? { lastConnectionError } : {}),
    };
  });
}

function projectTasks(input: {
  workspaceTabs: readonly WorkspaceTabState[];
  tasks: readonly ZCodeTaskMeta[];
  runtimeByWorkspaceKey: Readonly<
    Record<string, TaskRuntimeWorkspace["taskRuntimeByTaskId"] | undefined>
  >;
  pinned?: boolean;
  archived?: boolean;
}): WebRemoteControlTaskSnapshot[] {
  const tabsByKey = new Map(
    input.workspaceTabs.map((tab) => [
      getWorkspaceKey(tab.workspacePath, tab.workspaceIdentity),
      tab,
    ]),
  );
  return input.tasks
    .flatMap((task) => {
      const workspaceKey = getWorkspaceKey(task.workspacePath, task.workspaceIdentity);
      const tab = tabsByKey.get(workspaceKey);
      if (!tab) return [];
      const remote = Boolean(tab.workspaceIdentity || tab.remoteTarget || tab.remoteSessionId);
      const activity = getTaskListRowActivity(task);
      const hasBackgroundWork = activity?.hasBackgroundWork === true;
      const workflowActivity = activity?.workflowActivity;
      return [
        {
          taskId: task.taskId,
          title: task.title,
          workspacePath: task.workspacePath,
          ...(task.workspaceIdentity ? { workspaceIdentity: task.workspaceIdentity } : {}),
          ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
          workspaceLabel: tab.label,
          workspaceKind: remote ? ("remote" as const) : ("local" as const),
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          ...(task.provider ? { provider: task.provider } : {}),
          ...(typeof task.unreadAt === "number" ? { unreadAt: task.unreadAt } : {}),
          displayStatus: resolveTaskDisplayStatus(
            task,
            input.runtimeByWorkspaceKey[workspaceKey]?.[task.taskId]?.status,
          ),
          ...(hasBackgroundWork ? { hasBackgroundWork: true as const } : {}),
          ...(workflowActivity ? { workflowActivity } : {}),
          ...(input.pinned ? { pinned: true as const } : {}),
          ...(input.archived ? { archived: true as const } : {}),
        },
      ];
    })
    .sort(compareTaskSnapshotsWithinList);
}

function resolveTaskDisplayStatus(
  task: ZCodeTaskMeta,
  runtimeStatus: ZCodeTaskRuntimeStatus | undefined,
): NonNullable<WebRemoteControlTaskSnapshot["displayStatus"]> {
  const activity = getTaskListRowActivity(task);
  if (activity) {
    const fromPhase = mapSessionPhaseToDisplayStatus(activity.phase);
    if (fromPhase) return fromPhase;
  }
  if (runtimeStatus === "creating" || runtimeStatus === "streaming") return "running";
  if (runtimeStatus === "failed" || task.status === "error") return "error";
  if (runtimeStatus === "completed" || task.status === "completed") return "completed";
  return "idle";
}

function mapSessionPhaseToDisplayStatus(
  phase: NonNullable<ReturnType<typeof getTaskListRowActivity>>["phase"],
): WebRemoteControlTaskSnapshot["displayStatus"] | undefined {
  switch (phase) {
    case "prewarming":
    case "running":
      return "running";
    case "completedSuccess":
    case "completedInterrupted":
      return "completed";
    case "error":
      return "error";
    case "draft":
      return undefined;
  }
}

function isActiveSnapshot(task: WebRemoteControlTaskSnapshot): boolean {
  return task.displayStatus === "running" || task.hasBackgroundWork === true;
}

function compareTaskSnapshotsWithinList(
  left: WebRemoteControlTaskSnapshot,
  right: WebRemoteControlTaskSnapshot,
): number {
  const leftActive = isActiveSnapshot(left);
  if (leftActive !== isActiveSnapshot(right)) {
    return leftActive ? -1 : 1;
  }
  if (leftActive) {
    return right.createdAt === left.createdAt
      ? right.taskId.localeCompare(left.taskId)
      : right.createdAt - left.createdAt;
  }
  return compareMergedTaskSnapshots(left, right);
}

function compareMergedTaskSnapshots(
  left: WebRemoteControlTaskSnapshot,
  right: WebRemoteControlTaskSnapshot,
): number {
  if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt;
  if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt;
  return right.taskId.localeCompare(left.taskId);
}

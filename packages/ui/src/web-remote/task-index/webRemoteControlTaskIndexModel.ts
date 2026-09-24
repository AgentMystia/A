import type { IZCodeTaskService } from "@zcode/services";
import type {
  WebRemoteControlTaskSnapshot,
  WebRemoteControlWorkspaceSnapshot,
} from "@zcode/shared";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import { sortMobileRemoteTasks } from "@/web-remote/mobile/webRemoteControlMobileModel.js";
import type {
  WebRemoteControlMobileSortBy,
  WebRemoteControlMobileWorkspaceList,
} from "@/web-remote/mobile/webRemoteControlMobileTypes.js";

export const WEB_REMOTE_TASK_INDEX_EMPTY_RETRY_DELAY_MS = 300;
export const WEB_REMOTE_TASK_INDEX_EMPTY_MAX_ATTEMPTS = 3;

export type WebRemoteTaskIndexViewMode = "workspace" | "timeline" | "archived" | "grouped";

export type WebRemoteIndexedTaskService = Pick<
  IZCodeTaskService,
  | "setTaskPinned"
  | "archiveTask"
  | "unarchiveTask"
  | "deleteTask"
  | "listArchivedTasks"
  | "deleteArchivedTasks"
>;

export interface WebRemoteIndexedWorkspaceServices {
  services: { zcodeTaskService: WebRemoteIndexedTaskService };
  remoteSessionId?: string;
  isRemoteWorkspace: boolean;
}

export interface WebRemoteSessionDirectory {
  sessionsById: Record<
    string,
    { services: WebRemoteIndexedWorkspaceServices["services"] } | undefined
  >;
  sessionIdByWorkspaceIdentity: Record<string, string | undefined>;
  sessionIdByWorkspacePath: Record<string, string | undefined>;
}

export interface WebRemoteTaskIndexGroup {
  workspaceKey: string;
  workspace: WebRemoteControlWorkspaceSnapshot;
  tasks: WebRemoteControlTaskSnapshot[];
  totalTaskCount: number;
  collapsed: boolean;
  hasUnread: boolean;
}

export interface WebRemoteTaskIndexView {
  pinnedTasks: WebRemoteControlTaskSnapshot[];
  groups: WebRemoteTaskIndexGroup[];
  timelineTasks: WebRemoteControlTaskSnapshot[];
  archivedTasks: WebRemoteControlTaskSnapshot[];
  totalTaskCount: number;
}

export function shouldRetryEmptyWebRemoteTaskIndex(input: {
  activeTaskId?: string | null;
  attempt: number;
  maxAttempts: number;
  taskCount: number;
}): boolean {
  return Boolean(input.activeTaskId) && input.taskCount === 0 && input.attempt < input.maxAttempts;
}

export function isWebRemoteMutableWorkspace(workspace: WebRemoteControlWorkspaceSnapshot): boolean {
  return Boolean(
    workspace.kind === "remote" ||
    workspace.workspaceIdentity?.trim() ||
    workspace.remoteSessionId?.trim(),
  );
}

export function filterWebRemoteTaskIndexWorkspaces(
  activeWorkspaceIdentity: string | undefined,
  workspaces: readonly WebRemoteControlWorkspaceSnapshot[],
): WebRemoteControlWorkspaceSnapshot[] {
  return activeWorkspaceIdentity?.trim()
    ? workspaces.filter(isWebRemoteMutableWorkspace)
    : [...workspaces];
}

export function taskMatchesWebRemoteSearch(
  task: WebRemoteControlTaskSnapshot,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  return [
    task.title,
    task.workspaceLabel,
    task.workspacePath,
    task.workspaceIdentity ?? "",
    task.remoteSessionId ?? "",
  ]
    .join(" ")
    .toLocaleLowerCase()
    .includes(normalizedQuery);
}

export function filterWebRemoteTasksBySearch(
  tasks: readonly WebRemoteControlTaskSnapshot[],
  searchQuery: string,
): WebRemoteControlTaskSnapshot[] {
  const normalized = searchQuery.trim().toLocaleLowerCase();
  if (!normalized) return [...tasks];
  return tasks.filter((task) => taskMatchesWebRemoteSearch(task, normalized));
}

export function isSameWebRemoteIndexedTask(
  left: WebRemoteControlTaskSnapshot,
  right: WebRemoteControlTaskSnapshot,
): boolean {
  return (
    left.taskId === right.taskId &&
    getWorkspaceKey(left.workspacePath, left.workspaceIdentity) ===
      getWorkspaceKey(right.workspacePath, right.workspaceIdentity)
  );
}

export function patchWebRemoteTaskMembership(
  result: WebRemoteControlMobileWorkspaceList,
  target: WebRemoteControlTaskSnapshot,
  membership: { pinned?: boolean; archived?: boolean },
): WebRemoteControlMobileWorkspaceList {
  return {
    ...result,
    tasks: (result.tasks ?? []).map((task) => {
      if (!isSameWebRemoteIndexedTask(task, target)) return task;
      const next: WebRemoteControlTaskSnapshot = { ...task };
      // 发布包用 delete 去掉 false 标志，过滤条件读的是缺省而不是显式 false。
      delete next.pinned;
      delete next.archived;
      return {
        ...next,
        ...(membership.pinned ? { pinned: true as const } : {}),
        ...(membership.archived ? { archived: true as const } : {}),
      };
    }),
  };
}

export function removeWebRemoteIndexedTask(
  result: WebRemoteControlMobileWorkspaceList,
  target: WebRemoteControlTaskSnapshot,
): WebRemoteControlMobileWorkspaceList {
  return {
    ...result,
    tasks: (result.tasks ?? []).filter((task) => !isSameWebRemoteIndexedTask(task, target)),
  };
}

export function pruneCollapsedWorkspaceKeys(
  current: Set<string>,
  workspaceKeys: readonly string[],
): Set<string> {
  const allowed = new Set(workspaceKeys);
  const next = new Set([...current].filter((key) => allowed.has(key)));
  if (next.size === current.size && [...next].every((key) => current.has(key))) {
    return current;
  }
  return next;
}

export function toggleCollapsedWorkspaceKey(
  current: Set<string>,
  workspaceKey: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(workspaceKey)) next.delete(workspaceKey);
  else next.add(workspaceKey);
  return next;
}

function groupUnpinnedTasks(
  workspaces: readonly WebRemoteControlWorkspaceSnapshot[],
  tasks: readonly WebRemoteControlTaskSnapshot[],
  sortBy: WebRemoteControlMobileSortBy,
): Array<
  Omit<WebRemoteTaskIndexGroup, "collapsed" | "totalTaskCount"> & {
    tasks: WebRemoteControlTaskSnapshot[];
  }
> {
  const groups = workspaces.map((workspace) => ({
    workspaceKey: getWorkspaceKey(workspace.workspacePath, workspace.workspaceIdentity),
    workspace,
    tasks: [] as WebRemoteControlTaskSnapshot[],
    hasUnread: false,
  }));
  const groupByKey = new Map(groups.map((group) => [group.workspaceKey, group]));
  for (const task of tasks) {
    groupByKey.get(getWorkspaceKey(task.workspacePath, task.workspaceIdentity))?.tasks.push(task);
  }
  return groups.map((group) => ({
    ...group,
    tasks: sortMobileRemoteTasks(group.tasks, sortBy),
    hasUnread: group.tasks.some((task) => typeof task.unreadAt === "number"),
  }));
}

export function buildWebRemoteTaskIndexView(input: {
  result: WebRemoteControlMobileWorkspaceList;
  viewMode: WebRemoteTaskIndexViewMode;
  sortBy: WebRemoteControlMobileSortBy;
  searchQuery?: string;
  collapsedWorkspaceKeys?: ReadonlySet<string>;
}): WebRemoteTaskIndexView {
  const searchQuery = input.searchQuery ?? "";
  const collapsed = input.collapsedWorkspaceKeys ?? new Set<string>();
  const tasks = input.result.tasks ?? [];
  const pinnedTasks = sortMobileRemoteTasks(
    filterWebRemoteTasksBySearch(
      tasks.filter((task) => task.pinned && !task.archived),
      searchQuery,
    ),
    input.sortBy,
  );
  const unpinned = filterWebRemoteTasksBySearch(
    tasks.filter((task) => !task.pinned && !task.archived),
    searchQuery,
  );
  const archivedTasks = sortMobileRemoteTasks(
    filterWebRemoteTasksBySearch(
      tasks.filter((task) => task.archived),
      searchQuery,
    ),
    input.sortBy,
  );
  const timelineTasks = sortMobileRemoteTasks(unpinned, input.sortBy);
  const groups = groupUnpinnedTasks(input.result.workspaces, unpinned, "updated")
    .filter((group) => group.tasks.length > 0)
    .map((group) => {
      const isCollapsed = collapsed.has(group.workspaceKey);
      return {
        ...group,
        totalTaskCount: group.tasks.length,
        collapsed: isCollapsed,
        tasks: isCollapsed ? [] : group.tasks,
      };
    });
  const totalTaskCount =
    input.viewMode === "archived"
      ? archivedTasks.length
      : input.viewMode === "timeline"
        ? timelineTasks.length
        : groups.reduce((count, group) => count + group.totalTaskCount, 0);
  return { pinnedTasks, groups, timelineTasks, archivedTasks, totalTaskCount };
}

interface WorkspaceServiceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: unknown;
}

function resolveIndexedRemoteSessionId(
  workspace: WorkspaceServiceTarget,
  sessions: WebRemoteSessionDirectory,
): string | undefined {
  const identity = workspace.workspaceIdentity?.trim();
  const candidates = [
    workspace.remoteSessionId,
    identity ? sessions.sessionIdByWorkspaceIdentity[identity] : undefined,
    !identity && workspace.remoteTarget
      ? sessions.sessionIdByWorkspacePath[workspace.workspacePath]
      : undefined,
  ];
  return candidates.find((sessionId) => sessionId && sessions.sessionsById[sessionId]);
}

export function resolveWebRemoteWorkspaceServices(
  workspace: WorkspaceServiceTarget,
  localServices: WebRemoteIndexedWorkspaceServices["services"],
  sessions: WebRemoteSessionDirectory,
): WebRemoteIndexedWorkspaceServices | null {
  const remoteSessionId = resolveIndexedRemoteSessionId(workspace, sessions);
  const isRemoteWorkspace = Boolean(
    workspace.workspaceIdentity || workspace.remoteTarget || remoteSessionId,
  );
  if (isRemoteWorkspace) {
    const services = remoteSessionId ? sessions.sessionsById[remoteSessionId]?.services : undefined;
    return services ? { services, remoteSessionId, isRemoteWorkspace } : null;
  }
  return { services: localServices, isRemoteWorkspace };
}

export function mapWebRemoteWorkspaceServices(
  workspaces: readonly WebRemoteControlWorkspaceSnapshot[],
  localServices: WebRemoteIndexedWorkspaceServices["services"],
  sessions: WebRemoteSessionDirectory,
): Map<string, WebRemoteIndexedWorkspaceServices> {
  const resolved = new Map<string, WebRemoteIndexedWorkspaceServices>();
  for (const workspace of workspaces) {
    const services = resolveWebRemoteWorkspaceServices(workspace, localServices, sessions);
    if (!services) continue;
    resolved.set(getWorkspaceKey(workspace.workspacePath, workspace.workspaceIdentity), services);
  }
  return resolved;
}

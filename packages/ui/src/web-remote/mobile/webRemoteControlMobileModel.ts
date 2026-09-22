import type {
  WebRemoteControlTaskSnapshot,
  WebRemoteControlWorkspaceSnapshot,
} from "@zcode/shared";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import type {
  WebRemoteControlMobileSortBy,
  WebRemoteControlMobileTaskHomePreferences,
  WebRemoteControlMobileWorkspaceList,
} from "@/web-remote/mobile/webRemoteControlMobileTypes.js";

export const MOBILE_TASK_HOME_PREFERENCES_KEY =
  "zcode-web-remote-control-mobile-task-home-preferences";

export const DEFAULT_MOBILE_TASK_HOME_PREFERENCES: WebRemoteControlMobileTaskHomePreferences = {
  organizeBy: "workspace",
  sortBy: "updated",
};

export const EMPTY_MOBILE_WORKSPACE_LIST: WebRemoteControlMobileWorkspaceList = {
  workspaces: [],
  tasks: [],
};

export interface MobileTaskWorkspaceGroup {
  workspaceKey: string;
  workspace: WebRemoteControlWorkspaceSnapshot;
  tasks: WebRemoteControlTaskSnapshot[];
  hasUnread: boolean;
}

export interface MobileTaskHomeView {
  activeTaskId: string | null;
  activeWorkspaceKey: string;
  defaultExpandedWorkspaceKeys: Set<string>;
  pinnedTasks: WebRemoteControlTaskSnapshot[];
  timelineTasks: WebRemoteControlTaskSnapshot[];
  groups: MobileTaskWorkspaceGroup[];
  totalTaskCount: number;
  totalWorkspaceCount: number;
}

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function isMobileTaskRunning(task: WebRemoteControlTaskSnapshot): boolean {
  return task.displayStatus === "running" || task.hasBackgroundWork === true;
}

function compareMobileTasksByTime(
  left: WebRemoteControlTaskSnapshot,
  right: WebRemoteControlTaskSnapshot,
  sortBy: WebRemoteControlMobileSortBy,
): number {
  if (sortBy === "created") {
    if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt;
    if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt;
    return right.taskId.localeCompare(left.taskId);
  }
  if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt;
  if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt;
  return right.taskId.localeCompare(left.taskId);
}

/** 运行层按创建时间稳定排序，避免 updatedAt 被流式事件来回推。 */
export function compareMobileRemoteTasks(
  left: WebRemoteControlTaskSnapshot,
  right: WebRemoteControlTaskSnapshot,
  sortBy: WebRemoteControlMobileSortBy,
): number {
  const leftRunning = isMobileTaskRunning(left);
  const rightRunning = isMobileTaskRunning(right);
  if (leftRunning !== rightRunning) return leftRunning ? -1 : 1;
  if (leftRunning) {
    if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt;
    return right.taskId.localeCompare(left.taskId);
  }
  return compareMobileTasksByTime(left, right, sortBy);
}

export function sortMobileRemoteTasks(
  tasks: WebRemoteControlTaskSnapshot[],
  sortBy: WebRemoteControlMobileSortBy,
): WebRemoteControlTaskSnapshot[] {
  return [...tasks].sort((left, right) => compareMobileRemoteTasks(left, right, sortBy));
}

export function mobileTaskKey(task: WebRemoteControlTaskSnapshot): string {
  return `${getWorkspaceKey(task.workspacePath, task.workspaceIdentity)}:${task.taskId}`;
}

export function isRemoteWorkspaceDisconnected(
  workspace: WebRemoteControlWorkspaceSnapshot | undefined,
): boolean {
  return (
    workspace?.kind === "remote" &&
    (workspace.connectionState === "disconnected" || !workspace.remoteSessionId)
  );
}

export function latestTaskUpdatedAt(tasks: WebRemoteControlTaskSnapshot[]): number | null {
  if (tasks.length === 0) return null;
  return Math.max(...tasks.map((task) => task.updatedAt));
}

/**
 * 发布包分组调用没有传入用户 sortBy，因此分组内固定按 updated。
 * 置顶和时间线才使用偏好。
 */
export function groupMobileTasksByWorkspace(
  workspaces: WebRemoteControlWorkspaceSnapshot[],
  tasks: WebRemoteControlTaskSnapshot[],
): MobileTaskWorkspaceGroup[] {
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
    tasks: sortMobileRemoteTasks(group.tasks, "updated"),
    hasUnread: group.tasks.some((task) => typeof task.unreadAt === "number"),
  }));
}

export function buildMobileTaskHomeView(input: {
  activeTaskId?: string | null;
  activeWorkspaceIdentity?: string;
  activeWorkspacePath: string;
  sortBy: WebRemoteControlMobileSortBy;
  result: WebRemoteControlMobileWorkspaceList;
}): MobileTaskHomeView {
  const activeWorkspaceKey =
    input.result.activeWorkspaceKey ??
    getWorkspaceKey(input.activeWorkspacePath, input.activeWorkspaceIdentity);
  const activeTaskId = input.result.activeTaskId ?? input.activeTaskId ?? null;
  const visibleTasks = (input.result.tasks ?? []).filter((task) => !task.archived);
  const pinnedTasks = sortMobileRemoteTasks(
    visibleTasks.filter((task) => task.pinned),
    input.sortBy,
  );
  const unpinnedTasks = visibleTasks.filter((task) => !task.pinned);
  const groups = groupMobileTasksByWorkspace(input.result.workspaces, unpinnedTasks);
  const activeGroup = groups.some((group) => group.workspaceKey === activeWorkspaceKey);
  return {
    activeTaskId,
    activeWorkspaceKey,
    defaultExpandedWorkspaceKeys: new Set(activeGroup ? [activeWorkspaceKey] : []),
    pinnedTasks,
    timelineTasks: sortMobileRemoteTasks(unpinnedTasks, input.sortBy),
    groups,
    totalTaskCount: visibleTasks.length,
    totalWorkspaceCount: groups.length,
  };
}

export function mobileHomeInitialTaskMatched(view: MobileTaskHomeView): boolean {
  if (!view.activeTaskId) return true;
  const taskId = view.activeTaskId;
  const inPinned = view.pinnedTasks.some(
    (task) =>
      task.taskId === taskId &&
      getWorkspaceKey(task.workspacePath, task.workspaceIdentity) === view.activeWorkspaceKey,
  );
  if (inPinned) return true;
  return view.groups.some(
    (group) =>
      group.workspaceKey === view.activeWorkspaceKey &&
      group.tasks.some((task) => task.taskId === taskId),
  );
}

function isTaskHomePreferences(value: unknown): value is WebRemoteControlMobileTaskHomePreferences {
  if (typeof value !== "object" || !value) return false;
  const record = value as Partial<WebRemoteControlMobileTaskHomePreferences>;
  return (
    (record.organizeBy === "workspace" || record.organizeBy === "timeline") &&
    (record.sortBy === "created" || record.sortBy === "updated")
  );
}

export function readBrowserLocalStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readMobileTaskHomePreferences(
  storage: StorageLike | null = readBrowserLocalStorage(),
): WebRemoteControlMobileTaskHomePreferences {
  try {
    const raw = storage?.getItem(MOBILE_TASK_HOME_PREFERENCES_KEY);
    if (!raw) return DEFAULT_MOBILE_TASK_HOME_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    return isTaskHomePreferences(parsed) ? parsed : DEFAULT_MOBILE_TASK_HOME_PREFERENCES;
  } catch {
    return DEFAULT_MOBILE_TASK_HOME_PREFERENCES;
  }
}

export function writeMobileTaskHomePreferences(
  preferences: WebRemoteControlMobileTaskHomePreferences,
  storage: StorageLike | null = readBrowserLocalStorage(),
): void {
  try {
    storage?.setItem(MOBILE_TASK_HOME_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // localStorage 在隐私模式或配额用尽时会抛，偏好留在内存里。
  }
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    const text = JSON.stringify(value);
    if (text !== undefined) return text;
  } catch {
    // 循环引用落到 String。
  }
  return String(value);
}

export function stringifyMobileHomeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || String(error);
  if (typeof error === "object" && error && "message" in error) {
    const message = stringifyUnknown(error.message);
    if (message !== "undefined" && message.length > 0) return message;
  }
  return stringifyUnknown(error);
}

export function isMobileTaskOpenHomeFailure(message: string): boolean {
  return message.includes("远程工作区尚未连接") || message.includes("请先重连");
}

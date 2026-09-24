import type { WebRemoteControlStatus } from "@zcode/shared";

/** 发布包只在手机已连接且两个字段都非空时拼 key，字段本身不去空白。 */
export function resolveMobileActiveTaskKey(
  status: Pick<WebRemoteControlStatus, "mobileConnected" | "mobileViewState">,
): string | null {
  const view = status.mobileViewState;
  if (!status.mobileConnected || !view?.activeWorkspaceKey || !view.activeTaskId) {
    return null;
  }
  return `${view.activeWorkspaceKey}:${view.activeTaskId}`;
}

export function isMobileActiveTask(
  mobileActiveTaskKey: string | null,
  workspaceKey: string,
  taskId: string,
): boolean {
  return mobileActiveTaskKey === `${workspaceKey}:${taskId}`;
}

/**
 * 手机正在看的任务不在当前分页时，发布包刷新侧栏当前 workspace 的任务列表。
 * 可见性用去掉首尾空白后的 key 查找；已经为同一对刷新过则不再调用。
 */
export function resolveMobileActiveTaskListRefresh(input: {
  mobileConnected?: boolean;
  activeWorkspaceKey?: string;
  activeTaskId?: string;
  taskIsVisible: boolean;
  lastRefreshKey: string | null;
}): { nextRefreshKey: string | null; refresh: boolean } {
  const workspaceKey = input.activeWorkspaceKey?.trim() ?? "";
  const taskId = input.activeTaskId?.trim() ?? "";
  if (!input.mobileConnected || !workspaceKey || !taskId) {
    return { nextRefreshKey: null, refresh: false };
  }
  if (input.taskIsVisible) {
    return { nextRefreshKey: null, refresh: false };
  }
  const refreshKey = `${workspaceKey}:${taskId}`;
  if (input.lastRefreshKey === refreshKey) {
    return { nextRefreshKey: refreshKey, refresh: false };
  }
  return { nextRefreshKey: refreshKey, refresh: true };
}

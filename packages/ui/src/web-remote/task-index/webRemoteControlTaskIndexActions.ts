import type { WebRemoteControlTaskSnapshot } from "@zcode/shared";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import { logger } from "@/logger.js";
import {
  isMobileTaskOpenHomeFailure,
  mobileTaskKey,
  stringifyMobileHomeError,
} from "@/web-remote/mobile/webRemoteControlMobileModel.js";
import type {
  WebRemoteControlMobileSwitcher,
  WebRemoteControlMobileWorkspaceList,
} from "@/web-remote/mobile/webRemoteControlMobileTypes.js";
import {
  shouldRetryEmptyWebRemoteTaskIndex,
  WEB_REMOTE_TASK_INDEX_EMPTY_MAX_ATTEMPTS,
  WEB_REMOTE_TASK_INDEX_EMPTY_RETRY_DELAY_MS,
} from "@/web-remote/task-index/webRemoteControlTaskIndexModel.js";

export async function loadWebRemoteTaskIndex(input: {
  activeTaskId?: string | null;
  activeWorkspaceIdentity?: string;
  activeWorkspacePath: string;
  listWorkspaces: () => Promise<WebRemoteControlMobileWorkspaceList>;
  isCancelled: () => boolean;
  onResult: (result: WebRemoteControlMobileWorkspaceList) => void;
  delay?: () => Promise<void>;
}): Promise<"cancelled" | "ready" | { error: string }> {
  const delay =
    input.delay ??
    (() =>
      new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, WEB_REMOTE_TASK_INDEX_EMPTY_RETRY_DELAY_MS);
      }));
  try {
    for (let attempt = 0; attempt <= WEB_REMOTE_TASK_INDEX_EMPTY_MAX_ATTEMPTS; attempt += 1) {
      const result = await input.listWorkspaces();
      if (input.isCancelled()) return "cancelled";
      input.onResult(result);
      const taskCount = result.tasks?.length ?? 0;
      if (
        !shouldRetryEmptyWebRemoteTaskIndex({
          activeTaskId: input.activeTaskId,
          attempt,
          maxAttempts: WEB_REMOTE_TASK_INDEX_EMPTY_MAX_ATTEMPTS,
          taskCount,
        })
      ) {
        return "ready";
      }
      logger.debug(`[WebRemoteControlTaskIndex] 远控任务索引为空，等待桌面任务快照同步`, {
        activeTaskId: input.activeTaskId,
        activeWorkspaceIdentity: input.activeWorkspaceIdentity,
        activeWorkspacePath: input.activeWorkspacePath,
        attempt,
      });
      await delay();
      if (input.isCancelled()) return "cancelled";
    }
    return "ready";
  } catch (error) {
    if (input.isCancelled()) return "cancelled";
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[WebRemoteControlTaskIndex] 加载远程 task 索引失败`, { error: message });
    return { error: message };
  }
}

export async function openWebRemoteIndexedTask(input: {
  activeWorkspaceIdentity?: string;
  activeWorkspacePath: string;
  onNavigateHome?: () => void;
  onNavigateToChat?: () => void;
  onSelectTask: (workspacePath: string, taskId: string, workspaceIdentity?: string) => void;
  onSwitchingChange?: (switching: boolean) => void;
  onTaskOpen?: (event: { crossWorkspace: boolean }) => void;
  setError: (error: string | null) => void;
  setSwitchingTaskKey: (taskKey: string | null) => void;
  switcher: WebRemoteControlMobileSwitcher;
  task: WebRemoteControlTaskSnapshot;
}): Promise<void> {
  const currentKey = getWorkspaceKey(input.activeWorkspacePath, input.activeWorkspaceIdentity);
  const taskKey = getWorkspaceKey(input.task.workspacePath, input.task.workspaceIdentity);
  const crossWorkspace = taskKey !== currentKey;
  input.onTaskOpen?.({ crossWorkspace });
  if (!crossWorkspace) {
    input.onSelectTask(input.task.workspacePath, input.task.taskId, input.task.workspaceIdentity);
    try {
      await input.switcher.updateMobileViewState?.(taskKey, input.task.taskId);
    } catch (error) {
      logger.error("[useWebRemoteControlTaskOpen] 更新手机端查看状态失败", {
        error: stringifyMobileHomeError(error),
        taskId: input.task.taskId,
        workspaceKey: taskKey,
      });
    }
    input.onNavigateToChat?.();
    return;
  }
  input.onSwitchingChange?.(true);
  input.setSwitchingTaskKey(mobileTaskKey(input.task));
  input.setError(null);
  logger.info("[useWebRemoteControlTaskOpen] 开始切换远控 workspace", {
    taskId: input.task.taskId,
    workspaceKey: taskKey,
  });
  try {
    await input.switcher.switchWorkspace(taskKey, { taskId: input.task.taskId });
    // 发布包成功后不清理切换标志。壳用这个标志盖住会话列，失败路径才会把它放下。
  } catch (error) {
    const message = stringifyMobileHomeError(error);
    logger.error("[useWebRemoteControlTaskOpen] 打开远程 task 失败", {
      error: message,
      taskId: input.task.taskId,
      workspaceKey: taskKey,
    });
    input.setSwitchingTaskKey(null);
    input.onSwitchingChange?.(false);
    if (isMobileTaskOpenHomeFailure(message)) {
      input.onNavigateHome?.();
      return;
    }
    input.setError(message);
  }
}

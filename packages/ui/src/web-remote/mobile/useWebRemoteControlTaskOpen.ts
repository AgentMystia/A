import { useCallback, useState } from "react";
import type { WebRemoteControlTaskSnapshot } from "@zcode/shared";
import { logger } from "@/logger.js";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import {
  isMobileTaskOpenHomeFailure,
  mobileTaskKey,
  stringifyMobileHomeError,
} from "@/web-remote/mobile/webRemoteControlMobileModel.js";
import type {
  WebRemoteControlMobileNavigationIntent,
  WebRemoteControlMobileSwitcher,
} from "@/web-remote/mobile/webRemoteControlMobileTypes.js";

export function useWebRemoteControlTaskOpen(input: {
  activeWorkspaceIdentity?: string;
  activeWorkspacePath: string;
  markTaskReadOnOpen: boolean;
  mobileNavigationIntent?: WebRemoteControlMobileNavigationIntent;
  onNavigateHome?: () => void;
  onNavigateToChat?: () => void;
  onSelectTask: (workspacePath: string, taskId: string, workspaceIdentity?: string) => void;
  onSwitchingChange?: (switching: boolean) => void;
  switcher: WebRemoteControlMobileSwitcher;
}): {
  error: string | null;
  openTask: (task: WebRemoteControlTaskSnapshot) => void;
  switchingTaskKey: string | null;
} {
  const [switchingTaskKey, setSwitchingTaskKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    activeWorkspaceIdentity,
    activeWorkspacePath,
    markTaskReadOnOpen,
    mobileNavigationIntent,
    onNavigateHome,
    onNavigateToChat,
    onSelectTask,
    onSwitchingChange,
    switcher,
  } = input;

  const openTask = useCallback(
    (task: WebRemoteControlTaskSnapshot) => {
      void openMobileTask({
        activeWorkspaceIdentity,
        activeWorkspacePath,
        markTaskReadOnOpen,
        mobileNavigationIntent,
        onNavigateHome,
        onNavigateToChat,
        onSelectTask,
        onSwitchingChange,
        setError,
        setSwitchingTaskKey,
        switcher,
        task,
      });
    },
    [
      activeWorkspaceIdentity,
      activeWorkspacePath,
      markTaskReadOnOpen,
      mobileNavigationIntent,
      onNavigateHome,
      onNavigateToChat,
      onSelectTask,
      onSwitchingChange,
      switcher,
    ],
  );

  return { error, openTask, switchingTaskKey };
}

async function openMobileTask(input: {
  activeWorkspaceIdentity?: string;
  activeWorkspacePath: string;
  markTaskReadOnOpen: boolean;
  mobileNavigationIntent?: WebRemoteControlMobileNavigationIntent;
  onNavigateHome?: () => void;
  onNavigateToChat?: () => void;
  onSelectTask: (workspacePath: string, taskId: string, workspaceIdentity?: string) => void;
  onSwitchingChange?: (switching: boolean) => void;
  setError: (error: string | null) => void;
  setSwitchingTaskKey: (taskKey: string | null) => void;
  switcher: WebRemoteControlMobileSwitcher;
  task: WebRemoteControlTaskSnapshot;
}): Promise<void> {
  const currentKey = getWorkspaceKey(input.activeWorkspacePath, input.activeWorkspaceIdentity);
  const taskKey = getWorkspaceKey(input.task.workspacePath, input.task.workspaceIdentity);
  if (taskKey === currentKey) {
    await openTaskInCurrentWorkspace(input, taskKey);
    return;
  }
  await openTaskAcrossWorkspaces(input, taskKey);
}

async function openTaskInCurrentWorkspace(
  input: {
    markTaskReadOnOpen: boolean;
    onNavigateToChat?: () => void;
    onSelectTask: (workspacePath: string, taskId: string, workspaceIdentity?: string) => void;
    switcher: WebRemoteControlMobileSwitcher;
    task: WebRemoteControlTaskSnapshot;
  },
  taskKey: string,
): Promise<void> {
  if (
    input.markTaskReadOnOpen &&
    typeof input.task.unreadAt === "number" &&
    input.switcher.markTaskRead
  ) {
    const report = (error: unknown) => {
      logger.warn("[useWebRemoteControlTaskOpen] 标记手机端 task 已读失败", {
        error: stringifyMobileHomeError(error),
        taskId: input.task.taskId,
        workspaceKey: taskKey,
      });
    };
    try {
      // 发布包不 await 已读请求，选择任务和查看状态更新同时继续。
      void input.switcher.markTaskRead(input.task).catch(report);
    } catch (error) {
      report(error);
    }
  }
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
}

async function openTaskAcrossWorkspaces(
  input: {
    markTaskReadOnOpen: boolean;
    mobileNavigationIntent?: WebRemoteControlMobileNavigationIntent;
    onNavigateHome?: () => void;
    onSwitchingChange?: (switching: boolean) => void;
    setError: (error: string | null) => void;
    setSwitchingTaskKey: (taskKey: string | null) => void;
    switcher: WebRemoteControlMobileSwitcher;
    task: WebRemoteControlTaskSnapshot;
  },
  taskKey: string,
): Promise<void> {
  const switchingKey = mobileTaskKey(input.task);
  input.onSwitchingChange?.(true);
  input.setSwitchingTaskKey(switchingKey);
  input.setError(null);
  logger.info("[useWebRemoteControlTaskOpen] 开始切换远控 workspace", {
    taskId: input.task.taskId,
    workspaceKey: taskKey,
  });
  try {
    await input.switcher.switchWorkspace(taskKey, {
      taskId: input.task.taskId,
      ...(input.mobileNavigationIntent
        ? { mobileNavigationIntent: input.mobileNavigationIntent }
        : {}),
      ...(input.markTaskReadOnOpen && typeof input.task.unreadAt === "number"
        ? { markTaskReadExpectedUnreadAt: input.task.unreadAt }
        : {}),
    });
    // 发布包只在失败时清切换态。当前壳不会因 switchWorkspace 卸载，
    // 成功后不清的话遮罩会一直盖住已经打开的会话。
    input.setSwitchingTaskKey(null);
    input.onSwitchingChange?.(false);
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

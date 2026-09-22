import { useCallback, type Dispatch, type MouseEvent, type SetStateAction } from "react";
import type { WebRemoteControlTaskSnapshot } from "@zcode/shared";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { logger } from "@/logger.js";
import { getWorkspaceKey } from "@/lib/workspaceKey.js";
import { mobileTaskKey } from "@/web-remote/mobile/webRemoteControlMobileModel.js";
import type { WebRemoteIndexedWorkspaceServices } from "@/web-remote/task-index/webRemoteControlTaskIndexModel.js";

function taskTarget(task: WebRemoteControlTaskSnapshot) {
  return {
    taskId: task.taskId,
    workspacePath: task.workspacePath,
    ...(task.workspaceIdentity ? { workspaceIdentity: task.workspaceIdentity } : {}),
  };
}

function clearMutating(
  setMutatingTaskKey: Dispatch<SetStateAction<string | null>>,
  requestKey: string,
) {
  setMutatingTaskKey((current) => (current === requestKey ? null : current));
}

export function useWebRemoteTaskIndexMutations(input: {
  confirmDialog: ReturnType<typeof useConfirmDialog>;
  intl: { formatMessage: (descriptor: { id: string }) => string };
  patchMembership: (
    task: WebRemoteControlTaskSnapshot,
    membership: { pinned?: boolean; archived?: boolean },
  ) => void;
  pendingArchiveTaskKey: string | null;
  removeTask: (task: WebRemoteControlTaskSnapshot) => void;
  removeTaskState: (workspacePath: string, taskId: string, workspaceIdentity?: string) => void;
  servicesByWorkspace: Map<string, WebRemoteIndexedWorkspaceServices>;
  setMutatingTaskKey: Dispatch<SetStateAction<string | null>>;
  setPendingArchiveTaskKey: Dispatch<SetStateAction<string | null>>;
}) {
  const {
    confirmDialog,
    intl,
    patchMembership,
    pendingArchiveTaskKey,
    removeTask,
    removeTaskState,
    servicesByWorkspace,
    setMutatingTaskKey,
    setPendingArchiveTaskKey,
  } = input;

  const togglePin = useCallback(
    (event: MouseEvent, task: WebRemoteControlTaskSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      const workspaceKey = getWorkspaceKey(task.workspacePath, task.workspaceIdentity);
      const resolved = servicesByWorkspace.get(workspaceKey);
      if (!resolved) return;
      const requestKey = mobileTaskKey(task);
      const pinned = !task.pinned;
      setPendingArchiveTaskKey(null);
      setMutatingTaskKey(requestKey);
      void resolved.services.zcodeTaskService
        .setTaskPinned({ ...taskTarget(task), pinned })
        .then(() => {
          patchMembership(task, { pinned, archived: false });
        })
        .catch((error: unknown) => {
          logger.warn(`[WebRemoteControlTaskIndex] 更新远控任务置顶状态失败`, {
            error: error instanceof Error ? error.message : String(error),
            taskId: task.taskId,
            workspaceKey,
          });
          toast(intl.formatMessage({ id: "taskList.pinFailed" }));
        })
        .finally(() => {
          clearMutating(setMutatingTaskKey, requestKey);
        });
    },
    [intl, patchMembership, servicesByWorkspace, setMutatingTaskKey, setPendingArchiveTaskKey],
  );

  const archiveTask = useCallback(
    (event: MouseEvent, task: WebRemoteControlTaskSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      const requestKey = mobileTaskKey(task);
      if (pendingArchiveTaskKey !== requestKey) {
        setPendingArchiveTaskKey(requestKey);
        return;
      }
      const workspaceKey = getWorkspaceKey(task.workspacePath, task.workspaceIdentity);
      const resolved = servicesByWorkspace.get(workspaceKey);
      if (!resolved) return;
      setPendingArchiveTaskKey(null);
      setMutatingTaskKey(requestKey);
      void resolved.services.zcodeTaskService
        .archiveTask(taskTarget(task))
        .then(() => {
          patchMembership(task, { pinned: false, archived: true });
        })
        .catch((error: unknown) => {
          logger.warn(`[WebRemoteControlTaskIndex] 归档远控任务失败`, {
            error: error instanceof Error ? error.message : String(error),
            taskId: task.taskId,
            workspaceKey,
          });
          toast(intl.formatMessage({ id: "taskList.archiveFailed" }));
        })
        .finally(() => {
          clearMutating(setMutatingTaskKey, requestKey);
        });
    },
    [
      intl,
      patchMembership,
      pendingArchiveTaskKey,
      servicesByWorkspace,
      setMutatingTaskKey,
      setPendingArchiveTaskKey,
    ],
  );

  const unarchiveTask = useCallback(
    (event: MouseEvent, task: WebRemoteControlTaskSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      const workspaceKey = getWorkspaceKey(task.workspacePath, task.workspaceIdentity);
      const resolved = servicesByWorkspace.get(workspaceKey);
      if (!resolved) return;
      const requestKey = mobileTaskKey(task);
      setPendingArchiveTaskKey(null);
      setMutatingTaskKey(requestKey);
      void resolved.services.zcodeTaskService
        .unarchiveTask(taskTarget(task))
        .then(() => {
          patchMembership(task, { pinned: false, archived: false });
        })
        .catch((error: unknown) => {
          logger.warn(`[WebRemoteControlTaskIndex] 取消归档远控任务失败`, {
            error: error instanceof Error ? error.message : String(error),
            taskId: task.taskId,
            workspaceKey,
          });
        })
        .finally(() => {
          clearMutating(setMutatingTaskKey, requestKey);
        });
    },
    [patchMembership, servicesByWorkspace, setMutatingTaskKey, setPendingArchiveTaskKey],
  );

  const deleteArchivedTask = useCallback(
    (event: MouseEvent, task: WebRemoteControlTaskSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        const confirmed = await confirmDialog({
          title: intl.formatMessage({ id: "confirmDialog.archivedTaskDeleteTitle" }),
          description: intl.formatMessage({ id: "confirmDialog.archivedTaskDeleteDescription" }),
          confirmLabel: intl.formatMessage({ id: "taskList.delete" }),
        });
        if (!confirmed) return;
        const workspaceKey = getWorkspaceKey(task.workspacePath, task.workspaceIdentity);
        const resolved = servicesByWorkspace.get(workspaceKey);
        if (!resolved) return;
        const requestKey = mobileTaskKey(task);
        setPendingArchiveTaskKey(null);
        setMutatingTaskKey(requestKey);
        try {
          await resolved.services.zcodeTaskService.deleteTask(taskTarget(task));
          removeTask(task);
          removeTaskState(task.workspacePath, task.taskId, task.workspaceIdentity);
        } catch (error) {
          logger.warn(`[WebRemoteControlTaskIndex] 删除归档远控任务失败`, {
            error: error instanceof Error ? error.message : String(error),
            taskId: task.taskId,
            workspaceKey,
          });
        } finally {
          clearMutating(setMutatingTaskKey, requestKey);
        }
      })();
    },
    [
      confirmDialog,
      intl,
      removeTask,
      removeTaskState,
      servicesByWorkspace,
      setMutatingTaskKey,
      setPendingArchiveTaskKey,
    ],
  );

  return { archiveTask, deleteArchivedTask, togglePin, unarchiveTask };
}

import { useEffect, useMemo } from "react";
import type { WebRemoteControlTaskSnapshot } from "@zcode/shared";

import { useGlobalTaskList } from "@/hooks/useGlobalTaskList.js";
import { logger } from "@/logger.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

import {
  buildWebRemoteControlTaskSyncSnapshot,
  canSyncWebRemoteControlTasks,
} from "./webRemoteControlSnapshotSync.js";

const TASK_SYNC_LIST = {
  sortBy: "updated" as const,
  searchQuery: "",
  expanded: true,
  collapsedLimit: 100,
};

/**
 * 三个列表还在加载时不能把半成品快照交给 main。
 * manager 会整表替换已接受任务，空列表会把手机端正在看的任务清掉。
 */
export function WebRemoteControlTaskSync({
  syncWebRemoteControlTasks,
  workspaceTabs,
}: {
  syncWebRemoteControlTasks: (tasks: WebRemoteControlTaskSnapshot[]) => void;
  workspaceTabs: WorkspaceTabState[];
}) {
  const workspaces = useZCodeSessionStore((state) => state.workspaces);
  const timeline = useGlobalTaskList({
    kind: "timeline",
    workspaceTabs,
    ...TASK_SYNC_LIST,
  });
  const pinned = useGlobalTaskList({
    kind: "pinned",
    workspaceTabs,
    ...TASK_SYNC_LIST,
  });
  const archived = useGlobalTaskList({
    kind: "archived",
    workspaceTabs,
    ...TASK_SYNC_LIST,
  });
  const tasks = useMemo(
    () =>
      buildWebRemoteControlTaskSyncSnapshot({
        workspaceTabs,
        workspaces,
        pinnedTasks: pinned.items,
        timelineTasks: timeline.items,
        archivedTasks: archived.items,
      }),
    [archived.items, pinned.items, timeline.items, workspaceTabs, workspaces],
  );
  const ready = canSyncWebRemoteControlTasks({
    archivedLoading: archived.loading,
    enabled: true,
    pinnedLoading: pinned.loading,
    timelineLoading: timeline.loading,
  });

  useEffect(() => {
    if (!ready) {
      logger.debug("[Root] 暂缓同步 Web 远控任务快照，等待任务列表加载完成", {
        pinnedLoading: pinned.loading,
        archivedLoading: archived.loading,
        timelineLoading: timeline.loading,
      });
      return;
    }
    syncWebRemoteControlTasks(tasks);
  }, [archived.loading, pinned.loading, ready, syncWebRemoteControlTasks, tasks, timeline.loading]);

  return null;
}

import {
  BOT_TASK_LIST_CHANNEL,
  BOT_TASK_STREAM_CHANNEL,
  type ZCodeProvider,
  type ZCodeTaskMeta,
} from "@zcode/shared";
import type { BroadcastMessage } from "@zcode/services";
import { normalizeZCodeUiError } from "@/lib/zcodeUiError.js";
import { buildTaskEntityKey } from "@/lib/taskQueryCache.js";
import { mergeTaskMetaCandidates } from "@/lib/zcodeTaskMetaMerge.js";
import { getTaskMeta } from "@/store/zcodeSessionStoreSelectors.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import type { WindowTabState } from "@/store/tabStore.js";
import {
  applyTaskQueryCacheMutation,
  useTaskQueryCacheStore,
} from "@/store/taskQueryCacheStore.js";
import {
  botTaskListRuntimeStatus,
  mergeBotTaskUsage,
  readBotTaskListPayload,
  readBotTaskStreamPayload,
  shouldBumpBotTaskList,
  shouldProjectBotTaskStream,
  workspaceMatchesOpenTab,
  type BotTaskListPayload,
  type BotTaskStreamPayload,
} from "@/bots/botTaskBroadcastPayload.js";

/** 发布包把“不在普通列表”的 previous membership 写成 pinned 且 archived。 */
const ABSENT_TASK_LIST_MEMBERSHIP = { pinned: true, archived: true };

/**
 * 发布包在 usage_update 里记下正用量 key。没有任何读取点，
 * 但调用本身在样式包里，去掉会让 renderer 少掉这段副作用。
 */
const positiveContextUsageKeys = new Set<string>();

interface BotTaskListMembership {
  pinned: boolean;
  archived: boolean;
}

function recordPositiveContextUsage(input: {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
  size: number;
  used: number;
}): void {
  if (
    !Number.isFinite(input.used) ||
    input.used <= 0 ||
    !Number.isFinite(input.size) ||
    input.size <= 0
  ) {
    return;
  }
  const workspaceKey = input.workspaceIdentity?.trim() || input.workspacePath;
  positiveContextUsageKeys.add(`${input.workspacePath}::${workspaceKey}::${input.taskId}`);
}

function sortTasksByRecency(tasks: readonly ZCodeTaskMeta[]): ZCodeTaskMeta[] {
  return [...tasks].sort((left, right) =>
    right.updatedAt === left.updatedAt
      ? right.createdAt === left.createdAt
        ? right.taskId.localeCompare(left.taskId)
        : right.createdAt - left.createdAt
      : right.updatedAt - left.updatedAt,
  );
}

function upsertBroadcastTask(input: {
  workspacePath: string;
  workspaceIdentity?: string;
  task: ZCodeTaskMeta;
  membership?: BotTaskListMembership;
  forceInsertMembership?: boolean;
  ensureInWorkspaceTaskCache?: boolean;
  preserveListMembership?: boolean;
  applyQueryCacheMutation?: boolean;
}): void {
  const session = useZCodeSessionStore.getState();
  const workspace = session.getWorkspaceState(input.workspacePath, input.workspaceIdentity);
  // 发布包 skillStore `no`：两边都有时用缓存做底、乐观元数据覆盖。
  const previousTask = getTaskMeta(workspace, input.task.taskId);
  const cachedMeta =
    useTaskQueryCacheStore.getState().taskMetaByEntityKey[
      buildTaskEntityKey({
        taskId: input.task.taskId,
        workspacePath: input.workspacePath,
        workspaceIdentity: input.workspaceIdentity ?? input.task.workspaceIdentity,
      })
    ];
  const task = mergeTaskMetaCandidates(input.task, previousTask, cachedMeta) ?? input.task;
  const cachedTasks = workspace.taskListCache ?? [];
  const alreadyListed = cachedTasks.some((item) => item.taskId === task.taskId);
  const ordinaryMembership =
    input.membership?.pinned === false && input.membership.archived === false;
  const nextCache = input.preserveListMembership
    ? cachedTasks.map((item) => (item.taskId === task.taskId ? task : item))
    : ordinaryMembership
      ? sortTasksByRecency([task, ...cachedTasks.filter((item) => item.taskId !== task.taskId)])
      : cachedTasks.filter((item) => item.taskId !== task.taskId);
  if (
    workspace.taskListCache !== null &&
    ((input.preserveListMembership && alreadyListed) ||
      input.ensureInWorkspaceTaskCache ||
      alreadyListed ||
      !ordinaryMembership)
  ) {
    session.setTaskListCache(input.workspacePath, nextCache, input.workspaceIdentity);
  }
  session.upsertOptimisticTaskListItem(input.workspacePath, task, input.workspaceIdentity);
  useTaskQueryCacheStore.getState().upsertTaskMeta(task);
  if (input.preserveListMembership) {
    useTaskQueryCacheStore.getState().updateTaskMetaPreservingMembership(task);
    return;
  }
  if (input.membership && input.applyQueryCacheMutation !== false) {
    applyTaskQueryCacheMutation({
      previousTask: previousTask ?? task,
      nextTask: task,
      previousState:
        previousTask && !input.forceInsertMembership
          ? input.membership
          : ABSENT_TASK_LIST_MEMBERSHIP,
      nextState: input.membership,
    });
  }
}

function projectBotTaskStream(payload: BotTaskStreamPayload): void {
  const session = useZCodeSessionStore.getState();
  const workspace = session.getWorkspaceState(payload.workspacePath, payload.workspaceIdentity);
  if (
    !shouldProjectBotTaskStream({
      activeTaskId: workspace.activeTaskId,
      taskId: payload.taskId,
      workspaceIdentity: payload.workspaceIdentity,
    })
  ) {
    return;
  }
  const event = payload.event;
  switch (event.type) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
    case "tool_call":
      session.setTaskRuntimeState(
        payload.workspacePath,
        payload.taskId,
        "streaming",
        undefined,
        payload.workspaceIdentity,
      );
      break;
    case "permission_request":
      session.setTaskPermissionRequest(
        payload.workspacePath,
        payload.taskId,
        event,
        payload.workspaceIdentity,
      );
      session.setTaskRuntimeState(
        payload.workspacePath,
        payload.taskId,
        "streaming",
        undefined,
        payload.workspaceIdentity,
      );
      break;
    case "task_complete":
      session.setTaskRuntimeState(
        payload.workspacePath,
        payload.taskId,
        "completed",
        undefined,
        payload.workspaceIdentity,
      );
      session.setTaskPermissionRequest(
        payload.workspacePath,
        payload.taskId,
        null,
        payload.workspaceIdentity,
      );
      session.setTaskError(payload.workspacePath, payload.taskId, null, payload.workspaceIdentity);
      break;
    case "task_error": {
      const error = normalizeZCodeUiError(
        { message: event.error, detail: event.detail, code: event.code },
        {
          fallbackCode: event.code ?? "UNKNOWN",
          traceId: event.traceId,
          taskId: event.taskId,
        },
      );
      session.setTaskRuntimeState(
        payload.workspacePath,
        payload.taskId,
        "failed",
        error.message,
        payload.workspaceIdentity,
      );
      session.setTaskPermissionRequest(
        payload.workspacePath,
        payload.taskId,
        null,
        payload.workspaceIdentity,
      );
      session.setTaskError(payload.workspacePath, payload.taskId, error, payload.workspaceIdentity);
      break;
    }
    case "task_warning":
      session.setTaskError(
        payload.workspacePath,
        payload.taskId,
        normalizeZCodeUiError(
          { message: event.warning, detail: event.detail, code: event.code },
          {
            fallbackCode: event.code ?? "WARNING",
            traceId: event.traceId,
            taskId: event.taskId,
          },
        ),
        payload.workspaceIdentity,
      );
      break;
    case "usage_update": {
      const currentUsage =
        session.getWorkspaceState(payload.workspacePath, payload.workspaceIdentity)
          .taskRuntimeByTaskId[payload.taskId]?.usage ?? null;
      const usage = mergeBotTaskUsage({
        currentUsage,
        incomingUsage: {
          size: event.size,
          used: event.used,
          cost: event.cost,
          ...(event.cache ? { cache: event.cache } : {}),
          ...(event.breakdown ? { breakdown: event.breakdown } : {}),
        },
      });
      recordPositiveContextUsage({
        workspacePath: payload.workspacePath,
        workspaceIdentity: payload.workspaceIdentity,
        taskId: payload.taskId,
        size: event.size,
        used: event.used,
      });
      session.setTaskContextWindow(
        payload.workspacePath,
        payload.taskId,
        event.size,
        payload.workspaceIdentity,
      );
      session.setTaskUsage(payload.workspacePath, payload.taskId, usage, payload.workspaceIdentity);
      break;
    }
    case "session_info_update":
      if (event.apiRetry !== undefined) {
        session.setTaskApiRetryStatus(
          payload.workspacePath,
          payload.taskId,
          event.apiRetry ?? null,
          payload.workspaceIdentity,
        );
      }
      break;
    default:
      break;
  }
}

function projectBotTaskList(payload: BotTaskListPayload): void {
  const session = useZCodeSessionStore.getState();
  const workspace = session.getWorkspaceState(payload.workspacePath, payload.workspaceIdentity);
  const provider = payload.task?.provider ?? payload.provider;
  const isActiveTask = workspace.activeTaskId === payload.taskId;
  if (provider && isActiveTask) {
    session.bindRuntimeProvider(
      payload.workspacePath,
      provider as ZCodeProvider,
      payload.workspaceIdentity,
    );
  }
  if (payload.configOptions) {
    session.setTaskConfigOptions(
      payload.workspacePath,
      payload.taskId,
      payload.configOptions,
      payload.workspaceIdentity,
    );
  }
  const status = botTaskListRuntimeStatus(payload.event);
  if (status) {
    session.setTaskRuntimeState(
      payload.workspacePath,
      payload.taskId,
      status,
      undefined,
      payload.workspaceIdentity,
    );
  }
  const membership = { pinned: false, archived: false };
  if (payload.task) {
    if (payload.event === "created") {
      upsertBroadcastTask({
        workspacePath: payload.workspacePath,
        workspaceIdentity: payload.workspaceIdentity,
        task: payload.task,
        membership,
        forceInsertMembership: true,
        ensureInWorkspaceTaskCache: membership.pinned === false && membership.archived === false,
      });
    } else {
      upsertBroadcastTask({
        workspacePath: payload.workspacePath,
        workspaceIdentity: payload.workspaceIdentity,
        task: payload.task,
        membership,
        ensureInWorkspaceTaskCache: true,
      });
    }
  }
  if (payload.event === "permission_request" && payload.permissionRequest) {
    session.setTaskPermissionRequest(
      payload.workspacePath,
      payload.taskId,
      payload.permissionRequest,
      payload.workspaceIdentity,
    );
  } else if (payload.event === "permission_resolved" && payload.requestId) {
    session.removeTaskPermissionRequest(
      payload.workspacePath,
      payload.taskId,
      payload.requestId,
      payload.workspaceIdentity,
    );
  } else if (payload.event === "elicitation_request" && payload.elicitationRequest) {
    session.setTaskElicitationRequest(
      payload.workspacePath,
      payload.taskId,
      payload.elicitationRequest,
      payload.workspaceIdentity,
    );
  } else if (payload.event === "elicitation_resolved" && payload.requestId) {
    session.removeTaskElicitationRequest(
      payload.workspacePath,
      payload.taskId,
      payload.requestId,
      payload.workspaceIdentity,
    );
  } else if (payload.event === "completed" || payload.event === "error") {
    session.setTaskPermissionRequest(
      payload.workspacePath,
      payload.taskId,
      null,
      payload.workspaceIdentity,
    );
  }
  if (shouldBumpBotTaskList(payload.event, Boolean(payload.task))) {
    session.bumpTaskListVersion(payload.workspacePath, payload.workspaceIdentity);
  }
}

export function handleBotTaskBroadcastMessage(
  message: BroadcastMessage,
  tabs: readonly WindowTabState[],
): void {
  if (message.channel === BOT_TASK_STREAM_CHANNEL) {
    const payload = readBotTaskStreamPayload(message.payload);
    if (
      !payload ||
      !workspaceMatchesOpenTab(tabs, payload.workspacePath, payload.workspaceIdentity)
    ) {
      return;
    }
    projectBotTaskStream(payload);
    return;
  }
  if (message.channel !== BOT_TASK_LIST_CHANNEL) {
    return;
  }
  const payload = readBotTaskListPayload(message.payload);
  if (
    !payload ||
    !workspaceMatchesOpenTab(tabs, payload.workspacePath, payload.workspaceIdentity)
  ) {
    return;
  }
  projectBotTaskList(payload);
}

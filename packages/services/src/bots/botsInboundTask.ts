import type { BotInboundMessage, BotOutboundMessage, BotRuntimeState } from "@zcode/shared";
import { copy, getActorContextKey } from "./botsInboundText.js";
import { resolveOptionByValue } from "./botsHostHelpers.js";
import {
  createSelectionReply,
  createStatusReply,
  resolvePendingTaskSelectionEntry,
} from "./botsInboundDraft.js";
import {
  createCurrentWorkspaceRef,
  resolveZCodeTaskServiceForContext,
  type BotContextTaskEntry,
  type BotInboundTaskRuntime,
} from "./botsInboundRuntime.js";
import { filterAllowedWorkspaces, getWorkspaceKey } from "./botsNormalize.js";
import { isContextActiveTaskRunning } from "./botsTaskStream.js";

async function listContextTaskSelectionEntries(
  runtime: BotInboundTaskRuntime,
  context: BotRuntimeState,
  user: { allowedWorkspaces: string[] },
): Promise<BotContextTaskEntry[]> {
  const current = createCurrentWorkspaceRef(context);
  const workspaces = filterAllowedWorkspaces(
    await runtime.listWorkspaceRefs(current),
    user.allowedWorkspaces,
  ).filter(
    (item) =>
      getWorkspaceKey(item.workspacePath, item.workspaceIdentity) ===
        getWorkspaceKey(context.workspacePath, context.workspaceIdentity) ||
      (!context.workspaceIdentity && item.workspacePath === context.workspacePath),
  );
  const scoped = workspaces.length > 0 ? workspaces : [current];
  const listed = (
    await Promise.all(
      scoped.map(async (workspace) =>
        (
          await (
            await resolveZCodeTaskServiceForContext(runtime, workspace)
          )
            .listTasks({
              workspacePath: workspace.workspacePath,
              workspaceIdentity: workspace.workspaceIdentity,
            })
            .catch(() => [])
        ).map((task) => ({
          task,
          workspacePath: workspace.workspacePath,
          workspaceIdentity: workspace.workspaceIdentity,
        })),
      ),
    )
  ).flat();
  const unique = new Map<string, BotContextTaskEntry>();
  for (const entry of listed) {
    unique.set(`${getWorkspaceKey(entry.workspacePath, entry.workspaceIdentity)}:${entry.task.taskId}`, entry);
  }
  return [...unique.values()];
}

async function resolveTaskSelectionEntry(
  runtime: BotInboundTaskRuntime,
  message: BotInboundMessage,
  context: BotRuntimeState,
  user: { allowedWorkspaces: string[] },
  value: string,
): Promise<BotContextTaskEntry | null> {
  const pending = resolvePendingTaskSelectionEntry(runtime, message.actor, value);
  if (pending) {
    return pending;
  }
  const listed = await listContextTaskSelectionEntries(runtime, context, user);
  const option = resolveOptionByValue(
    listed.map((item) => ({ id: item.task.taskId, label: item.task.title, entry: item })),
    value,
  );
  if (option) {
    return option.entry;
  }
  const snapshot = await (
    await resolveZCodeTaskServiceForContext(runtime, context)
  )
    .getTaskSnapshot({
      taskId: value.trim(),
      workspacePath: context.workspacePath,
      workspaceIdentity: context.workspaceIdentity,
    })
    .catch(() => null);
  return snapshot
    ? { task: snapshot.meta, workspacePath: context.workspacePath, workspaceIdentity: context.workspaceIdentity }
    : null;
}

export async function handleTaskList(
  runtime: BotInboundTaskRuntime,
  message: BotInboundMessage,
): Promise<BotOutboundMessage[]> {
  const authorized = await runtime.withAuthorizedContext(message, "task");
  if (!authorized.ok) {
    return authorized.reply;
  }
  if (await isContextActiveTaskRunning(runtime, authorized.context)) {
    return runtime.replies(message.actor, copy(authorized.locale, "taskRunning"));
  }
  const entries = (await listContextTaskSelectionEntries(runtime, authorized.context, authorized.user)).slice(0, 10);
  const tasks = entries.map((item) => item.task);
  const current = authorized.context.activeTaskId
    ? tasks.find((item) => item.taskId === authorized.context.activeTaskId)
    : null;
  if (entries.length > 0) {
    runtime.taskSelectionEntries.set(
      getActorContextKey(message.actor),
      new Map(entries.map((item) => [item.task.taskId, item])),
    );
  } else {
    runtime.taskSelectionEntries.delete(getActorContextKey(message.actor));
  }
  if (tasks.length === 0) {
    return runtime.replies(message.actor, copy(authorized.locale, "noHistoryTasks"));
  }
  return createSelectionReply(
    runtime,
    message.actor,
    {
      id: `task-${Date.now()}`,
      title: copy(authorized.locale, "taskSelectTitle", {
        task: current ? `${current.title} (${current.taskId})` : "draft",
      }),
      currentId: authorized.context.activeTaskId ?? undefined,
      action: "task.set",
      options: entries.map((item) => ({
        id: item.task.taskId,
        label: item.task.title,
        description: item.task.status ?? "running",
      })),
    },
    authorized.locale,
  );
}

export async function handleTaskSet(
  runtime: BotInboundTaskRuntime,
  message: BotInboundMessage,
  value: string,
): Promise<BotOutboundMessage[]> {
  const authorized = await runtime.withAuthorizedContext(message, "task");
  if (!authorized.ok) {
    return authorized.reply;
  }
  const entry = await resolveTaskSelectionEntry(runtime, message, authorized.context, authorized.user, value);
  if (!entry) {
    return runtime.replies(message.actor, copy(authorized.locale, "taskMissing"));
  }
  if (authorized.context.activeTaskId !== entry.task.taskId && (await isContextActiveTaskRunning(runtime, authorized.context))) {
    return runtime.replies(message.actor, copy(authorized.locale, "taskRunning"));
  }
  const next = await runtime.persistContext({
    ...authorized.context,
    workspacePath: entry.workspacePath,
    workspaceIdentity: entry.workspaceIdentity,
    workspaceId: getWorkspaceKey(entry.workspacePath, entry.workspaceIdentity),
    mode: "task",
    activeTaskId: entry.task.taskId,
  });
  runtime.taskSelectionEntries.delete(getActorContextKey(message.actor));
  return createStatusReply(runtime, message.actor, next, authorized.locale);
}

export async function handleStopCommand(
  runtime: BotInboundTaskRuntime,
  message: BotInboundMessage,
): Promise<BotOutboundMessage[]> {
  const authorized = await runtime.withAuthorizedContext(message, "stop");
  if (!authorized.ok) {
    return authorized.reply;
  }
  if (!authorized.context.activeTaskId) {
    return runtime.replies(message.actor, copy(authorized.locale, "noActiveTask"));
  }
  try {
    await (
      await resolveZCodeTaskServiceForContext(runtime, authorized.context)
    ).stopGeneration({
      taskId: authorized.context.activeTaskId,
    });
  } catch (error) {
    return runtime.replies(
      message.actor,
      copy(authorized.locale, "taskFailed", {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  runtime.runningTasks.delete(authorized.context.activeTaskId);
  runtime.stopTyping(authorized.context.activeTaskId);
  return createStatusReply(runtime, message.actor, authorized.context, authorized.locale);
}

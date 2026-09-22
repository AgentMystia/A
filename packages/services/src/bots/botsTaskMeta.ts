import type { BotRuntimeState, ZCodeTaskMeta } from "@zcode/shared";
import { TERMINAL_TASK_META_RETRY_DELAYS_MS } from "./botsConstants.js";
import { resolveZCodeTaskServiceForContext, type BotInboundTaskRuntime } from "./botsInboundRuntime.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 发布包 host `readTaskMeta`。 */
export async function readTaskMeta(
  runtime: BotInboundTaskRuntime,
  context: Pick<BotRuntimeState, "workspacePath" | "workspaceIdentity">,
  taskId: string,
): Promise<ZCodeTaskMeta | null> {
  const tasks = await (
    await resolveZCodeTaskServiceForContext(runtime, context)
  ).listTasks({
    workspacePath: context.workspacePath,
    workspaceIdentity: context.workspaceIdentity,
  });
  return tasks.find((task) => task.taskId === taskId) ?? null;
}

/** 发布包 host `isTerminalTaskMeta`。 */
export function isTerminalTaskMeta(task: ZCodeTaskMeta | null, eventType: string): boolean {
  if (!task) {
    return false;
  }
  return eventType === "task_error" ? task.status === "error" : task.status === "completed";
}

/** 发布包 host `readTerminalTaskMeta`。 */
export async function readTerminalTaskMeta(
  runtime: BotInboundTaskRuntime,
  context: Pick<BotRuntimeState, "workspacePath" | "workspaceIdentity">,
  taskId: string,
  eventType: string,
): Promise<ZCodeTaskMeta | null> {
  let task = await readTaskMeta(runtime, context, taskId).catch(() => null);
  if (isTerminalTaskMeta(task, eventType)) {
    return task;
  }
  for (const wait of TERMINAL_TASK_META_RETRY_DELAYS_MS) {
    await delay(wait);
    task = await readTaskMeta(runtime, context, taskId).catch(() => task);
    if (isTerminalTaskMeta(task, eventType)) {
      return task;
    }
  }
  return task;
}

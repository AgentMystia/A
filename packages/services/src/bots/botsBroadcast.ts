import {
  BOT_TASK_LIST_CHANNEL,
  BOT_TASK_STREAM_CHANNEL,
  type BotRuntimeState,
  type ZCodeStreamEvent,
} from "@zcode/shared";
import type { BotInboundTaskRuntime } from "./botsInboundRuntime.js";

export { BOT_TASK_LIST_CHANNEL, BOT_TASK_STREAM_CHANNEL };

/**
 * 发布包 chunk 把频道导出为 JK/YK，host 绑定为 LT/FT。
 * 已恢复代码误用 bots:task-list；列表变更必须走 bots:task，每条流事件走 bots:task-stream。
 */

/** 发布包 host `broadcastTaskListChange`。 */
export async function broadcastTaskListChange(
  runtime: Pick<BotInboundTaskRuntime, "broadcastService">,
  context: Pick<BotRuntimeState, "workspacePath" | "workspaceIdentity">,
  taskId: string,
  event: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await runtime.broadcastService
    ?.send({
      channel: BOT_TASK_LIST_CHANNEL,
      payload: {
        workspacePath: context.workspacePath,
        workspaceIdentity: context.workspaceIdentity,
        taskId,
        event,
        updatedAt: Date.now(),
        ...extra,
      },
    })
    .catch(() => undefined);
}

/** 发布包 host `broadcastTaskStreamEvent`。 */
export async function broadcastTaskStreamEvent(
  runtime: Pick<BotInboundTaskRuntime, "broadcastService">,
  context: Pick<BotRuntimeState, "workspacePath" | "workspaceIdentity">,
  event: ZCodeStreamEvent,
): Promise<void> {
  await runtime.broadcastService
    ?.send({
      channel: BOT_TASK_STREAM_CHANNEL,
      payload: {
        workspacePath: context.workspacePath,
        workspaceIdentity: context.workspaceIdentity,
        taskId: event.taskId,
        event,
        updatedAt: Date.now(),
      },
    })
    .catch(() => undefined);
}

/** 发布包 host `broadcastTaskConfigSync`。 */
export async function broadcastTaskConfigSync(
  runtime: Pick<BotInboundTaskRuntime, "broadcastService">,
  input: {
    context: Pick<BotRuntimeState, "workspacePath" | "workspaceIdentity">;
    taskId: string;
    task?: unknown;
    provider?: unknown;
    configOptions?: unknown;
  },
): Promise<void> {
  await broadcastTaskListChange(runtime, input.context, input.taskId, "updated", {
    ...(input.task ? { task: input.task } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.configOptions ? { configOptions: input.configOptions } : {}),
  });
}

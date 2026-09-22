import type { BotActor, BotConfigEntry, BotRuntimeState, ZCodeStreamEvent } from "@zcode/shared";
import { broadcastTaskListChange, broadcastTaskStreamEvent } from "./botsBroadcast.js";
import { createCompletedElicitationOutbound } from "./botsElicitationBuild.js";
import { clearPendingElicitationSelection } from "./botsElicitationParse.js";
import {
  clearPendingElicitationForRequest,
  handleElicitationRequest,
} from "./botsInboundElicitation.js";
import type { BotInboundTaskRuntime } from "./botsInboundRuntime.js";
import { copy, getActorContextKey } from "./botsInboundText.js";
import { createOutbound } from "./botsOutbound.js";
import { readTerminalTaskMeta } from "./botsTaskMeta.js";
import { finalizeTransientInteractionCard } from "./botsTransientCards.js";

/** 发布包 host `watchTaskStream` 的事件处理：先广播流事件，再处理 elicitation 与终态。 */
export async function handlePublishedTaskStreamEvent(
  runtime: BotInboundTaskRuntime,
  bot: BotConfigEntry,
  actor: BotActor,
  context: BotRuntimeState,
  key: string,
  event: ZCodeStreamEvent,
  broadcast: boolean,
): Promise<void> {
  if (event.type === "task_stream_mirror_batch") {
    if (broadcast) {
      await broadcastTaskStreamEvent(runtime, context, event);
    }
    for (const op of event.ops) {
      if (op.kind === "stream_event") {
        await handlePublishedTaskStreamEvent(runtime, bot, actor, context, key, op.event, false);
      }
    }
    return;
  }
  if (broadcast) {
    await broadcastTaskStreamEvent(runtime, context, event);
  }
  if (event.type === "elicitation_request") {
    await handleElicitationRequest(runtime, bot, actor, context, event);
    return;
  }
  if (event.type === "elicitation_response") {
    await clearPendingElicitationForRequest(runtime, context, event.requestId);
    await broadcastTaskListChange(runtime, context, event.taskId, "elicitation_resolved", {
      requestId: event.requestId,
    });
    return;
  }
  if (event.type !== "task_complete" && event.type !== "task_error") {
    return;
  }
  runtime.runningTasks.delete(event.taskId);
  runtime.stopTyping(event.taskId);
  if (context.pendingElicitation?.taskId === event.taskId) {
    clearPendingElicitationSelection(runtime, context.pendingElicitation);
    await runtime.persistContext({ ...context, pendingElicitation: undefined });
  }
  const card = runtime.transientCards.get(getActorContextKey(actor));
  if (card?.taskId === event.taskId) {
    const locale = await runtime.readMessageLocale();
    const outbound = context.pendingElicitation
      ? createCompletedElicitationOutbound(
          runtime.replies,
          actor,
          context.pendingElicitation,
          locale,
          "cancel",
        )[0]
      : undefined;
    const message = outbound
      ? createOutbound(actor, outbound.text, outbound.selection, {
          locale,
          elicitation: outbound.elicitation,
        })
      : createOutbound(
          actor,
          event.type === "task_error"
            ? copy(locale, "taskFailed", {
                message: "error" in event ? String(event.error) : "error",
              })
            : copy(locale, "received"),
          undefined,
          { locale },
        );
    await finalizeTransientInteractionCard(
      runtime.providers,
      runtime.transientCards,
      runtime.logger,
      actor,
      message,
    );
  }
  const terminal = await readTerminalTaskMeta(runtime, context, event.taskId, event.type).catch(
    () => null,
  );
  await broadcastTaskListChange(
    runtime,
    context,
    event.taskId,
    event.type === "task_error" ? "error" : "completed",
    {
      ...(terminal ? { task: terminal } : {}),
      ...(event.type === "task_error"
        ? { error: "error" in event ? String(event.error) : "error" }
        : {}),
    },
  );
  runtime.streamSubs.get(key)?.dispose();
  runtime.streamSubs.delete(key);
  const locale = await runtime.readMessageLocale();
  const text =
    event.type === "task_error"
      ? copy(locale, "taskFailed", { message: "error" in event ? String(event.error) : "error" })
      : locale === "en-US"
        ? "Task completed."
        : "任务已完成。";
  await runtime.sendOutbound(bot, createOutbound(actor, text, undefined, { locale }));
}

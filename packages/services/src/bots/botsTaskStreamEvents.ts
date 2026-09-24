import {
  appendAssistantMessagePart,
  normalizeBotReplyGranularity,
  type BotActor,
  type BotConfigEntry,
  type BotRuntimeState,
  type ZCodeStreamEvent,
} from "@zcode/shared";
import type { IZCodeTaskService } from "../session/zcodeTaskService.js";
import { writeContext } from "./botsContext.js";
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
import {
  createAssistantReplyBlocks,
  formatBotAssistantReplyBlocks,
  updateBotReplyToolCalls,
} from "./botsReplyBlocks.js";
import {
  extractBotAssistantResponseMessages,
  formatBotToolCallReply,
  isBotToolCallReplyTerminal,
} from "./botsReplyFormat.js";
import {
  readLatestAssistantTurnChangeSummary,
  updateLiveStatusProgress,
} from "./botsStatusProgress.js";
import {
  appendStreamingCardMessageChunk,
  appendStreamingCardMessages,
  appendStreamingCardTool,
  hasStreamingCardMessageText,
  sealStreamingCardReply,
  supportsStreamingCardReply,
  syncStreamingCardReply,
  type PublishedTaskStreamSession,
} from "./botsStreamingCardSync.js";
import { readTerminalTaskMeta } from "./botsTaskMeta.js";
import { handleStreamPermissionRequest } from "./botsTaskStreamPermission.js";
import { finalizeTransientInteractionCard } from "./botsTransientCards.js";

/** 发布包 host `flushAssistantReplyBuffer`。 */
async function flushAssistantReplyBuffer(
  runtime: BotInboundTaskRuntime,
  bot: BotConfigEntry,
  actor: BotActor,
  session: PublishedTaskStreamSession,
  force: boolean,
): Promise<void> {
  const mode = normalizeBotReplyGranularity(bot.provider, bot.replyMode);
  if (
    mode === "summary_changes" ||
    supportsStreamingCardReply(runtime, bot) ||
    !session.assistantBuffer
  ) {
    return;
  }
  const extracted = extractBotAssistantResponseMessages(session.assistantBuffer, force);
  session.assistantBuffer = extracted.rest;
  for (const text of extracted.messages) {
    session.sentReply = true;
    await runtime.sendOutbound(bot, createOutbound(actor, text));
  }
}

/** 发布包 host 没有 `handlePublishedTaskStreamEvent` 这个 keepName。函数声明会留下名字。 */
export const handlePublishedTaskStreamEvent = (() => {
  return async (
    runtime: BotInboundTaskRuntime,
    bot: BotConfigEntry,
    actor: BotActor,
    context: BotRuntimeState,
    key: string,
    session: PublishedTaskStreamSession,
    taskService: IZCodeTaskService,
    event: ZCodeStreamEvent,
    broadcast: boolean,
  ): Promise<void> => {
    if (event.type === "task_stream_mirror_batch") {
      if (broadcast) {
        await broadcastTaskStreamEvent(runtime, context, event);
      }
      for (const op of event.ops) {
        if (op.kind === "stream_event") {
          await handlePublishedTaskStreamEvent(
            runtime,
            bot,
            actor,
            context,
            key,
            session,
            taskService,
            op.event,
            false,
          );
        }
      }
      return;
    }
    if (broadcast) {
      await broadcastTaskStreamEvent(runtime, context, event);
    }
    updateLiveStatusProgress(runtime.liveStatusProgress, event);
    const mode = normalizeBotReplyGranularity(bot.provider, bot.replyMode);
    if (event.type === "agent_message_chunk") {
      session.parts = appendAssistantMessagePart(session.parts, {
        type: "content",
        content: event.content,
      });
      if (supportsStreamingCardReply(runtime, bot)) {
        appendStreamingCardMessageChunk(session, event.content);
        await syncStreamingCardReply(runtime, bot, actor, context, session, event.type, false);
        return;
      }
      if (mode !== "summary_changes") {
        session.assistantBuffer += event.content;
        await flushAssistantReplyBuffer(runtime, bot, actor, session, false);
      }
      return;
    }
    if (event.type === "agent_thought_chunk") {
      session.parts = appendAssistantMessagePart(session.parts, {
        type: "thought",
        content: event.content,
      });
    }
    if (event.type === "tool_call" || event.type === "tool_call_update") {
      if (supportsStreamingCardReply(runtime, bot)) {
        appendStreamingCardTool(session, event.toolId);
      } else {
        await flushAssistantReplyBuffer(runtime, bot, actor, session, true);
      }
      if (!session.seenToolIds.has(event.toolId)) {
        session.seenToolIds.add(event.toolId);
        session.parts = appendAssistantMessagePart(session.parts, {
          type: "tool-call",
          toolId: event.toolId,
        });
      }
    }
    updateBotReplyToolCalls(session.toolCalls, event);
    if (event.type === "tool_call" && supportsStreamingCardReply(runtime, bot)) {
      await syncStreamingCardReply(runtime, bot, actor, context, session, event.type, true);
    }
    if (event.type === "tool_call_update" && supportsStreamingCardReply(runtime, bot)) {
      await syncStreamingCardReply(
        runtime,
        bot,
        actor,
        context,
        session,
        event.type,
        isBotToolCallReplyTerminal(event.status),
      );
    }
    if (
      event.type === "tool_call_update" &&
      mode === "assistant_toolcalls_changes" &&
      isBotToolCallReplyTerminal(event.status) &&
      !session.repliedToolIds.has(event.toolId)
    ) {
      const toolCall = session.toolCalls.get(event.toolId);
      if (toolCall) {
        session.repliedToolIds.add(event.toolId);
        session.sentReply = true;
        const locale = await runtime.readMessageLocale();
        await runtime.sendOutbound(
          bot,
          createOutbound(
            actor,
            formatBotToolCallReply(toolCall, { workspacePath: context.workspacePath, locale }),
          ),
        );
      }
    }
    if (event.type === "permission_request") {
      await handleStreamPermissionRequest(runtime, bot, actor, context, session, event);
      return;
    }
    if (event.type === "elicitation_request") {
      await sealStreamingCardReply(runtime, bot, actor, context, session);
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
    runtime.liveStatusProgress.delete(event.taskId);
    runtime.stopTyping(event.taskId);
    if (context.pendingElicitation?.taskId === event.taskId) {
      clearPendingElicitationSelection(runtime, context.pendingElicitation);
      await writeContext(runtime, { ...context, pendingElicitation: undefined });
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
              ? copy(locale, "taskFailed", { message: event.error })
              : copy(locale, "received"),
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
        ...(event.type === "task_error" ? { error: event.error } : {}),
      },
    );
    runtime.streamSubs.get(key)?.dispose();
    runtime.streamSubs.delete(key);
    if (event.type === "task_error") {
      if (supportsStreamingCardReply(runtime, bot)) {
        session.card.status = "error";
        if (!hasStreamingCardMessageText(session)) {
          const locale = await runtime.readMessageLocale();
          appendStreamingCardMessages(session, [
            copy(locale, "taskFailed", { message: event.error }),
          ]);
        }
        await syncStreamingCardReply(runtime, bot, actor, context, session, event.type, true);
        return;
      }
      const locale = await runtime.readMessageLocale();
      await runtime.sendOutbound(
        bot,
        createOutbound(actor, copy(locale, "taskFailed", { message: event.error })),
      );
      return;
    }
    const locale = await runtime.readMessageLocale();
    const snapshot = await taskService
      .getTaskSnapshot({
        taskId: event.taskId,
        workspacePath: context.workspacePath,
        workspaceIdentity: context.workspaceIdentity,
      })
      .catch(() => null);
    const changeSummary = readLatestAssistantTurnChangeSummary(snapshot);
    const formatContext = { workspacePath: context.workspacePath, locale };
    if (supportsStreamingCardReply(runtime, bot)) {
      const extra = formatBotAssistantReplyBlocks(
        createAssistantReplyBlocks([], new Map(), mode, changeSummary),
        formatContext,
      );
      if (extra.length > 0) {
        appendStreamingCardMessages(session, extra);
      }
      session.card.status = "completed";
      await syncStreamingCardReply(runtime, bot, actor, context, session, event.type, true);
      session.sentReply = true;
      return;
    }
    const messages =
      mode === "summary_changes"
        ? formatBotAssistantReplyBlocks(
            createAssistantReplyBlocks(session.parts, session.toolCalls, mode, changeSummary),
            formatContext,
          )
        : await flushAssistantReplyBuffer(runtime, bot, actor, session, true).then(() =>
            formatBotAssistantReplyBlocks(
              createAssistantReplyBlocks([], new Map(), mode, changeSummary),
              formatContext,
            ),
          );
    if (messages.length === 0 && !session.sentReply) {
      await runtime.sendOutbound(
        bot,
        createOutbound(actor, locale === "en-US" ? "Task completed." : "任务已完成。"),
      );
      return;
    }
    for (const text of messages) {
      session.sentReply = true;
      await runtime.sendOutbound(bot, createOutbound(actor, text));
    }
  };
})();

import type { BotInboundMessage, BotOutboundMessage, ZCodeProvider } from "@zcode/shared";
import { isRemoteWorkspaceConnected, writeContext } from "./botsContext.js";
import { copy } from "./botsInboundText.js";
import { createBotTraceId, deriveSessionTitle } from "./botsHostHelpers.js";
import {
  completeBotModelSelection,
  readModelSelectionView,
  toBotTaskProvider,
  buildInitializedDraftOptions,
} from "./botsDraft.js";
import { handlePendingElicitationText as handleElicitationText } from "./botsInboundElicitation.js";
import {
  resolveZCodeTaskServiceForContext,
  type BotInboundTaskRuntime,
} from "./botsInboundRuntime.js";
import { writeDraftContext } from "./botsInboundDraft.js";
import {
  applyDraftConfigOptions,
  isContextActiveTaskRunning,
  sendPromptInBackground,
  watchTaskStream,
} from "./botsTaskStream.js";
import { getWorkspaceKey } from "./botsNormalize.js";
import { formatAttachmentRejectedReason, prepareBotMessageContent } from "./botsAttachments.js";
import { broadcastTaskListChange } from "./botsBroadcast.js";

/** 发布包 host `handleMessage`。对象方法或别名不会留下这个 keepName。 */
export async function handleMessage(
  runtime: BotInboundTaskRuntime,
  message: BotInboundMessage,
): Promise<BotOutboundMessage[]> {
  const authorized = await runtime.withAuthorizedContext(message, "message");
  if (!authorized.ok) {
    return authorized.reply;
  }
  let replacedTaskId: string | undefined;
  if (authorized.context.mode === "task" && authorized.context.activeTaskId) {
    const deleted = await (
      await resolveZCodeTaskServiceForContext(runtime, authorized.context)
    )
      .listDeletedTaskIds({
        workspacePath: authorized.context.workspacePath,
        workspaceIdentity: authorized.context.workspaceIdentity,
      })
      // 发布包 unique G4 无 catch；测试 Host 常无 zcodeTaskService，缺失时不能让 /message 崩掉。
      .catch((): string[] => []);
    if (deleted.includes(authorized.context.activeTaskId)) {
      replacedTaskId = authorized.context.activeTaskId;
      authorized.context = await writeDraftContext(runtime, authorized.context);
    }
  }
  const elicitation = await handleElicitationText(runtime, authorized, message.actor, message.text);
  if (elicitation) {
    return elicitation;
  }
  if (
    authorized.context.mode === "task" &&
    authorized.context.activeTaskId &&
    (await isContextActiveTaskRunning(runtime, authorized.context))
  ) {
    return runtime.replies(message.actor, copy(authorized.locale, "taskRunning"));
  }
  let prepared;
  try {
    prepared = await prepareBotMessageContent(
      authorized.bot,
      message,
      authorized.locale,
      runtime.providers,
    );
  } catch (error) {
    return runtime.replies(
      message.actor,
      copy(authorized.locale, "attachmentRejected", {
        message: formatAttachmentRejectedReason(error, authorized.locale),
      }),
    );
  }
  if (authorized.context.mode === "draft" || !authorized.context.activeTaskId) {
    const draft =
      authorized.context.draftOptions ??
      (await buildInitializedDraftOptions(authorized.context, (item) =>
        isRemoteWorkspaceConnected(runtime, item),
      ));
    const view = await readModelSelectionView(runtime, authorized.context, draft.modelSelection);
    const selection = draft.modelSelection ? view?.effectiveSelection : view?.preferredSelection;
    if (!selection || !view || (draft.modelSelection && view.selectionIssue)) {
      throw new Error("Bot 无法从目标 Host 解析 Submission 模型");
    }
    const completed = completeBotModelSelection(view, {
      providerId: selection.providerId,
      modelId: selection.modelId,
      ...(selection.options ? { options: { ...selection.options } } : {}),
    });
    if (!completed) {
      throw new Error("Bot 无法从目标 Host 解析 Submission 模型");
    }
    const nextDraft = { ...draft, modelSelection: completed };
    const taskService = await resolveZCodeTaskServiceForContext(runtime, authorized.context);
    const created = await taskService.createTask({
      workspacePath: authorized.context.workspacePath,
      workspaceIdentity: authorized.context.workspaceIdentity,
      ...(toBotTaskProvider(draft.provider) === "glm"
        ? { provider: "glm" satisfies ZCodeProvider }
        : {}),
      modelSelection: nextDraft.modelSelection,
    });
    const title = deriveSessionTitle(prepared.content, prepared.zcodeAttachments);
    const createdTask = title ? { ...created, title } : created;
    const traceId = createBotTraceId(created.taskId);
    try {
      await applyDraftConfigOptions(
        runtime,
        { ...authorized.context, draftOptions: nextDraft },
        created.taskId,
        traceId,
      );
    } catch (error) {
      await taskService
        .deleteTask({
          taskId: created.taskId,
          workspacePath: authorized.context.workspacePath,
          workspaceIdentity: authorized.context.workspaceIdentity,
        })
        .catch(() => undefined);
      throw error;
    }
    const next = await writeContext(runtime, {
      ...authorized.context,
      mode: "task",
      activeTaskId: created.taskId,
      draftOptions: undefined,
    });
    await broadcastTaskListChange(runtime, next, created.taskId, "created", { task: createdTask });
    if (replacedTaskId) {
      runtime.logger.info(
        undefined,
        `replaced deleted Bot task bot=${authorized.bot.id} oldTask=${replacedTaskId} newTask=${created.taskId} workspace=${getWorkspaceKey(next.workspacePath, next.workspaceIdentity)}`,
      );
      await runtime
        .sendOutbound(authorized.bot, {
          botId: authorized.bot.id,
          provider: authorized.bot.provider,
          providerUserId: message.actor.chatId ?? message.actor.providerUserId,
          text: copy(authorized.locale, "deletedTaskReplaced"),
          locale: authorized.locale,
        })
        .catch((error) => {
          runtime.logger.warn(
            undefined,
            `deleted task replacement notice failed bot=${authorized.bot.id} task=${created.taskId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    }
    runtime.runningTasks.add(created.taskId);
    await watchTaskStream(runtime, authorized.bot, message.actor, next);
    await broadcastTaskListChange(runtime, next, created.taskId, "prompt_sent", {
      task: createdTask,
      prompt: {
        content: prepared.content,
        attachments: prepared.zcodeAttachments.length > 0 ? prepared.zcodeAttachments : undefined,
        messageId: `bot-${traceId}`,
        sentAt: Date.now(),
      },
    });
    sendPromptInBackground(
      runtime,
      authorized.bot,
      message.actor,
      next,
      created.taskId,
      traceId,
      prepared.content,
      prepared.zcodeAttachments,
      nextDraft.modelSelection,
    );
    return [];
  }
  const taskService = await resolveZCodeTaskServiceForContext(runtime, authorized.context);
  await taskService.resumeTask({
    taskId: authorized.context.activeTaskId,
    workspacePath: authorized.context.workspacePath,
    workspaceIdentity: authorized.context.workspaceIdentity,
  });
  const current = await taskService.getTaskModelSelection({
    taskId: authorized.context.activeTaskId,
  });
  const view = current ? await readModelSelectionView(runtime, authorized.context, current) : null;
  const effective = view?.effectiveSelection;
  if (!effective || view?.selectionIssue) {
    throw new Error(copy(authorized.locale, "sessionModelUnavailable"));
  }
  await broadcastTaskListChange(
    runtime,
    authorized.context,
    authorized.context.activeTaskId,
    "resumed",
  );
  runtime.runningTasks.add(authorized.context.activeTaskId);
  await watchTaskStream(runtime, authorized.bot, message.actor, authorized.context);
  const resumeTraceId = createBotTraceId(authorized.context.activeTaskId);
  await broadcastTaskListChange(
    runtime,
    authorized.context,
    authorized.context.activeTaskId,
    "prompt_sent",
    {
      prompt: {
        content: prepared.content,
        attachments: prepared.zcodeAttachments.length > 0 ? prepared.zcodeAttachments : undefined,
        messageId: `bot-${resumeTraceId}`,
        sentAt: Date.now(),
      },
    },
  );
  sendPromptInBackground(
    runtime,
    authorized.bot,
    message.actor,
    authorized.context,
    authorized.context.activeTaskId,
    resumeTraceId,
    prepared.content,
    prepared.zcodeAttachments,
    effective,
  );
  return [];
}

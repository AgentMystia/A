import type { BotInboundMessage, BotOutboundMessage, ZCodeProvider } from "@zcode/shared";
import { copy } from "./botsInboundText.js";
import { createBotTraceId, deriveSessionTitle } from "./botsHostHelpers.js";
import { completeBotModelSelection, readModelSelectionView, toBotTaskProvider, buildInitializedDraftOptions } from "./botsDraft.js";
import { handlePendingElicitationText as handleElicitationText } from "./botsInboundElicitation.js";
import {
  createTaskServiceResolver,
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

/** 发布包 host `prepareBotMessageContent` 子集：测试无附件，正文原样提交。 */
export function prepareBotMessageContent(
  message: BotInboundMessage,
  locale: "zh-CN" | "en-US",
): { content: string; zcodeAttachments: Array<{ kind: string; filename: string; mimeType: string; dataBase64: string }> } {
  return {
    content: message.text.trim() || (message.attachments?.length ? copy(locale, "attachmentOnlyPrompt") : ""),
    zcodeAttachments: [],
  };
}

/** 发布包 host `handleMessage`。 */
export async function handleBotMessage(
  runtime: BotInboundTaskRuntime,
  message: BotInboundMessage,
): Promise<BotOutboundMessage[]> {
  const authorized = await runtime.withAuthorizedContext(message, "message");
  if (!authorized.ok) {
    return authorized.reply;
  }
  let replacedTaskId: string | undefined;
  if (authorized.context.mode === "task" && authorized.context.activeTaskId) {
    const deleted = await (await resolveZCodeTaskServiceForContext(runtime, authorized.context))
      .listDeletedTaskIds({
        workspacePath: authorized.context.workspacePath,
        workspaceIdentity: authorized.context.workspaceIdentity,
      })
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
  if (authorized.context.mode === "task" && authorized.context.activeTaskId && (await isContextActiveTaskRunning(runtime, authorized.context))) {
    return runtime.replies(message.actor, copy(authorized.locale, "taskRunning"));
  }
  const prepared = prepareBotMessageContent(message, authorized.locale);
  if (authorized.context.mode === "draft" || !authorized.context.activeTaskId) {
    const draft = authorized.context.draftOptions ?? (await buildInitializedDraftOptions(authorized.context, (item) => runtime.isRemoteConnected(item)));
    const view = await readModelSelectionView(createTaskServiceResolver(runtime), authorized.context, draft.modelSelection);
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
      ...(toBotTaskProvider(draft.provider) === "glm" ? { provider: "glm" satisfies ZCodeProvider } : {}),
      modelSelection: nextDraft.modelSelection,
    });
    const title = deriveSessionTitle(prepared.content, prepared.zcodeAttachments);
    const createdTask = title ? { ...created, title } : created;
    const traceId = createBotTraceId(created.taskId);
    try {
      await applyDraftConfigOptions(runtime, { ...authorized.context, draftOptions: nextDraft }, created.taskId, traceId);
    } catch (error) {
      await taskService.deleteTask({
        taskId: created.taskId,
        workspacePath: authorized.context.workspacePath,
        workspaceIdentity: authorized.context.workspaceIdentity,
      }).catch(() => undefined);
      throw error;
    }
    const next = await runtime.persistContext({
      ...authorized.context,
      mode: "task",
      activeTaskId: created.taskId,
      draftOptions: undefined,
    });
    await runtime.broadcastService
      ?.send({
        channel: "bots:task-list",
        payload: {
          workspacePath: next.workspacePath,
          workspaceIdentity: next.workspaceIdentity,
          taskId: created.taskId,
          event: "created",
          task: createdTask,
          updatedAt: Date.now(),
        },
      })
      .catch(() => undefined);
    if (replacedTaskId) {
      runtime.logger.info(
        undefined,
        `replaced deleted Bot task bot=${authorized.bot.id} oldTask=${replacedTaskId} newTask=${created.taskId} workspace=${getWorkspaceKey(next.workspacePath, next.workspaceIdentity)}`,
      );
    }
    runtime.runningTasks.add(created.taskId);
    await watchTaskStream(runtime, authorized.bot, message.actor, next);
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
  const current = await taskService.getTaskModelSelection({ taskId: authorized.context.activeTaskId });
  const view = current ? await readModelSelectionView(createTaskServiceResolver(runtime), authorized.context, current) : null;
  const effective = view?.effectiveSelection;
  if (!effective || view?.selectionIssue) {
    throw new Error(copy(authorized.locale, "sessionModelUnavailable"));
  }
  runtime.runningTasks.add(authorized.context.activeTaskId);
  await watchTaskStream(runtime, authorized.bot, message.actor, authorized.context);
  sendPromptInBackground(
    runtime,
    authorized.bot,
    message.actor,
    authorized.context,
    authorized.context.activeTaskId,
    createBotTraceId(authorized.context.activeTaskId),
    prepared.content,
    prepared.zcodeAttachments,
    effective,
  );
  return [];
}

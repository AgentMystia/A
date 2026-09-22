import type {
  BotActor,
  BotAutomationRunWatch,
  BotConfigEntry,
  BotOutboundMessage,
  BotRuntimeState,
  ZCodeStreamEvent,
  ZCodeTaskMode,
  ZCodePromptAttachment,
} from "@zcode/shared";
import { AUTOMATION_DELIVERY_WARN_MS, BOT_FORCED_MODE, BOT_TYPING_INTERVAL_MS } from "./botsConstants.js";
import { copy } from "./botsInboundText.js";
import { findBot } from "./botsNormalize.js";
import {
  botTaskStreamKey,
  resolveZCodeTaskServiceForContext,
  type BotInboundTaskRuntime,
} from "./botsInboundRuntime.js";
import { listActiveTaskConfigOptions, findSelectConfigOption, resolveSupportedDraftMode, toBotTaskProvider } from "./botsDraft.js";
import { createBotTraceId } from "./botsHostHelpers.js";
import { createOutbound } from "./botsOutbound.js";
import type { BotProvider } from "./botsTypes.js";
import { formatUserFacingBotError, isSessionExpiredError } from "./botsErrors.js";
import { handleElicitationRequest } from "./botsInboundElicitation.js";
import { readTerminalTaskMeta } from "./botsTaskMeta.js";

export function createTypingController(providers: Record<string, BotProvider | null>): {
  startTyping(bot: BotConfigEntry, actor: BotActor, taskId: string): void;
  stopTyping(taskId: string): void;
  dispose(): void;
} {
  const live = new Map<string, { bot: BotConfigEntry; target: Parameters<NonNullable<BotProvider["startTyping"]>>[1] }>();
  const intervals = new Map<string, ReturnType<typeof setInterval>>();
  return {
    startTyping(bot, actor, taskId) {
      const provider = providers[bot.provider];
      const userId = actor.chatId ?? actor.providerUserId;
      if (!provider || !userId || live.has(taskId) || intervals.has(taskId)) {
        return;
      }
      const target = {
        providerUserId: userId,
        providerMessageId: actor.providerMessageId,
        providerContextToken: actor.providerContextToken,
      };
      if (provider.startTyping) {
        live.set(taskId, { bot, target });
        provider.startTyping(bot, target).catch(() => undefined);
        return;
      }
      if (provider.sendTyping) {
        provider.sendTyping(bot, target).catch(() => undefined);
        intervals.set(
          taskId,
          setInterval(() => {
            provider.sendTyping?.(bot, target).catch(() => undefined);
          }, BOT_TYPING_INTERVAL_MS),
        );
      }
    },
    stopTyping(taskId) {
      const liveHandle = live.get(taskId);
      if (liveHandle) {
        live.delete(taskId);
        providers[liveHandle.bot.provider]?.stopTyping?.(liveHandle.bot, liveHandle.target).catch(() => undefined);
      }
      const interval = intervals.get(taskId);
      if (interval) {
        clearInterval(interval);
        intervals.delete(taskId);
      }
    },
    dispose() {
      for (const taskId of [...live.keys(), ...intervals.keys()]) {
        this.stopTyping(taskId);
      }
    },
  };
}

async function broadcastTaskEvent(
  runtime: BotInboundTaskRuntime,
  context: BotRuntimeState,
  taskId: string,
  event: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await runtime.broadcastService
    ?.send({
      channel: "bots:task-list",
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

/** 发布包 host `applyDraftConfigOptions`：草稿强制 yolo。 */
export async function applyDraftConfigOptions(
  runtime: BotInboundTaskRuntime,
  context: BotRuntimeState,
  taskId: string,
  traceId: ReturnType<typeof createBotTraceId>,
): Promise<void> {
  const draft = context.draftOptions;
  if (!draft) {
    return;
  }
  const options = await listActiveTaskConfigOptions(
    { resolveZCodeTaskServiceForContext: (item) => resolveZCodeTaskServiceForContext(runtime, item), resolveModelSelectionServiceForContext: async () => null },
    context,
    taskId,
  );
  const mode = findSelectConfigOption(options, "mode");
  const supported = resolveSupportedDraftMode(options, BOT_FORCED_MODE, toBotTaskProvider(draft.provider));
  if (mode?.id && supported) {
    await (await resolveZCodeTaskServiceForContext(runtime, context)).setMode({
      taskId,
      mode: supported as ZCodeTaskMode,
    });
    return;
  }
  if (mode?.id) {
    runtime.logger.debug(traceId, `skip forced yolo mode unsupported provider=${draft.provider}`);
  }
}

/** 发布包 host `isContextActiveTaskRunning`。 */
export async function isContextActiveTaskRunning(
  runtime: BotInboundTaskRuntime,
  context: BotRuntimeState,
): Promise<boolean> {
  if (!context.activeTaskId || !runtime.runningTasks.has(context.activeTaskId)) {
    return false;
  }
  if (context.workspaceIdentity && !(await runtime.isRemoteConnected(context))) {
    return false;
  }
  const snapshot = await (await resolveZCodeTaskServiceForContext(runtime, context))
    .getTaskSnapshot({
      taskId: context.activeTaskId,
      workspacePath: context.workspacePath,
      workspaceIdentity: context.workspaceIdentity,
    })
    .catch(() => null);
  if (snapshot?.meta.status === "completed" || snapshot?.meta.status === "error") {
    runtime.runningTasks.delete(context.activeTaskId);
    runtime.stopTyping(context.activeTaskId);
    return false;
  }
  return true;
}

/** 发布包 host `watchTaskStream` 子集：连续订阅终态并投递。 */
export async function watchTaskStream(
  runtime: BotInboundTaskRuntime,
  bot: BotConfigEntry,
  actor: BotActor,
  context: BotRuntimeState,
): Promise<void> {
  if (!context.activeTaskId) {
    return;
  }
  const key = botTaskStreamKey({ ...context, activeTaskId: context.activeTaskId });
  if (runtime.streamSubs.has(key)) {
    return;
  }
  const taskService = await resolveZCodeTaskServiceForContext(runtime, context);
  const subscribe = taskService.onDynamicTaskEvent({
    workspacePath: context.workspacePath,
    workspaceIdentity: context.workspaceIdentity,
    taskId: context.activeTaskId,
    // 发布包 deliveryKind 为 bot-channel-continuous，当前接口映射到 continuous。
    deliveryKind: "continuous",
  });
  let chain = Promise.resolve();
  const sub = subscribe((event: ZCodeStreamEvent) => {
    chain = chain.then(async () => {
      if (event.type === "elicitation_request") {
        await handleElicitationRequest(runtime, bot, actor, context, event);
        return;
      }
      if (event.type === "elicitation_response") {
        if (context.pendingElicitation?.requestId === event.requestId) {
          await runtime.persistContext({ ...context, pendingElicitation: undefined });
        }
        await broadcastTaskEvent(runtime, context, event.taskId, "elicitation_resolved", { requestId: event.requestId });
        return;
      }
      if (event.type !== "task_complete" && event.type !== "task_error") {
        return;
      }
      runtime.runningTasks.delete(event.taskId);
      runtime.stopTyping(event.taskId);
      runtime.streamSubs.get(key)?.dispose();
      runtime.streamSubs.delete(key);
      const terminal = await readTerminalTaskMeta(runtime, context, event.taskId, event.type).catch(() => null);
      await broadcastTaskEvent(runtime, context, event.taskId, event.type === "task_error" ? "error" : "completed", {
        ...(terminal ? { task: terminal } : {}),
        ...(event.type === "task_error" ? { error: "error" in event ? String(event.error) : "error" } : {}),
      });
      const locale = await runtime.readMessageLocale();
      const text =
        event.type === "task_error"
          ? copy(locale, "taskFailed", { message: "error" in event ? String(event.error) : "error" })
          : locale === "en-US"
            ? "Task completed."
            : "任务已完成。";
      await runtime.sendOutbound(bot, createOutbound(actor, text, undefined, { locale }));
    }).catch((error) => {
      runtime.logger.warn(
        undefined,
        `bot task stream event failed task=${event.taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  });
  runtime.streamSubs.set(key, sub);
  runtime.startTyping(bot, actor, context.activeTaskId);
}

export function sendPromptInBackground(
  runtime: BotInboundTaskRuntime,
  bot: BotConfigEntry,
  actor: BotActor,
  context: BotRuntimeState,
  taskId: string,
  traceId: ReturnType<typeof createBotTraceId>,
  content: string,
  attachments: ZCodePromptAttachment[],
  modelSelection: Parameters<NonNullable<BotInboundTaskRuntime["zcodeTaskService"]>["sendPrompt"]>[0]["modelSelection"],
): void {
  resolveZCodeTaskServiceForContext(runtime, context)
    .then((service) =>
      service.sendPrompt({
        taskId,
        traceId,
        content,
        attachments: attachments.length > 0 ? (attachments as never) : undefined,
        modelSelection,
      }),
    )
    .catch(async (error) => {
      const locale = await runtime.readMessageLocale();
      const message = formatUserFacingBotError(error, locale);
      runtime.runningTasks.delete(taskId);
      runtime.stopTyping(taskId);
      await broadcastTaskEvent(runtime, context, taskId, "error", {
        error: error instanceof Error ? error.message : String(error),
      });
      await runtime
        .sendOutbound(
          bot,
          createOutbound(
            actor,
            isSessionExpiredError(error) ? message : copy(locale, "taskFailed", { message }),
            undefined,
            { locale },
          ),
        )
        .catch(() => undefined);
    });
}

function warnAutomationDeliveryOnce(
  runtime: BotInboundTaskRuntime,
  watch: BotAutomationRunWatch,
  reason: string,
): void {
  const key = `${watch.target.provider}:${watch.target.botId}:${reason}`;
  const now = Date.now();
  const previous = runtime.automationWarnAt.get(key) ?? 0;
  if (now - previous < AUTOMATION_DELIVERY_WARN_MS) {
    return;
  }
  runtime.automationWarnAt.set(key, now);
  runtime.logger.warn(undefined, `automation Bot delivery skipped provider=${watch.target.provider} bot=${watch.target.botId} reason=${reason}`);
}

/** 发布包 host `watchAutomationRun`：不写 bot-state，只 watchTaskStream(summary_changes)。 */
export async function watchAutomationRun(
  runtime: BotInboundTaskRuntime,
  watch: BotAutomationRunWatch,
): Promise<void> {
  const config = await runtime.repo.readConfig();
  const bot = findBot(config, watch.target.botId);
  if (!bot) {
    warnAutomationDeliveryOnce(runtime, watch, "bot_missing");
    return;
  }
  if (!bot.enabled) {
    warnAutomationDeliveryOnce(runtime, watch, "bot_disabled");
    return;
  }
  if (bot.provider !== watch.target.provider) {
    warnAutomationDeliveryOnce(runtime, watch, "provider_mismatch");
    return;
  }
  const actor: BotActor = {
    provider: watch.target.provider,
    botId: watch.target.botId,
    providerUserId: watch.target.providerUserId,
    chatType: watch.target.chatType ?? "private",
  };
  const context: BotRuntimeState = {
    botId: bot.id,
    workspacePath: watch.workspacePath,
    ...(watch.workspaceIdentity ? { workspaceIdentity: watch.workspaceIdentity } : {}),
    mode: "task",
    activeTaskId: watch.taskId,
    updatedAt: Date.now(),
  };
  await watchTaskStream(runtime, { ...bot, replyMode: "summary_changes" }, actor, context);
}

export type { BotOutboundMessage };

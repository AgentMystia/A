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
import {
  AUTOMATION_DELIVERY_WARN_MS,
  BOT_FORCED_MODE,
  BOT_TYPING_INTERVAL_MS,
} from "./botsConstants.js";
import { copy } from "./botsInboundText.js";
import { findBot } from "./botsNormalize.js";
import {
  botTaskStreamKey,
  resolveZCodeTaskServiceForContext,
  type BotInboundTaskRuntime,
} from "./botsInboundRuntime.js";
import {
  listActiveTaskConfigOptions,
  findSelectConfigOption,
  resolveSupportedDraftMode,
  toBotTaskProvider,
} from "./botsDraft.js";
import { createBotTraceId, resolveAutomationBotDeliveryTarget } from "./botsHostHelpers.js";
import { createOutbound } from "./botsOutbound.js";
import type { BotProvider } from "./botsTypes.js";
import { broadcastTaskListChange } from "./botsBroadcast.js";
import { formatUserFacingBotError, isSessionExpiredError } from "./botsErrors.js";
import { handlePublishedTaskStreamEvent } from "./botsTaskStreamEvents.js";
import { createPublishedTaskStreamSession } from "./botsStreamingCardSync.js";

export function createTypingController(providers: Record<string, BotProvider | null>): {
  startTyping(bot: BotConfigEntry, actor: BotActor, taskId: string): void;
  stopTyping(taskId: string): void;
  stopInboundTyping(bot: BotConfigEntry, actor: BotActor): Promise<void>;
  dispose(): void;
} {
  const live = new Map<
    string,
    { bot: BotConfigEntry; target: Parameters<NonNullable<BotProvider["startTyping"]>>[1] }
  >();
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
        providers[liveHandle.bot.provider]
          ?.stopTyping?.(liveHandle.bot, liveHandle.target)
          .catch(() => undefined);
      }
      const interval = intervals.get(taskId);
      if (interval) {
        clearInterval(interval);
        intervals.delete(taskId);
      }
    },
    async stopInboundTyping(bot, actor) {
      const provider = providers[bot.provider];
      const userId = actor.chatId ?? actor.providerUserId;
      if (!provider?.stopTyping || !userId || !actor.providerMessageId) {
        return;
      }
      const stillLive = Array.from(live.values()).some(
        (entry) =>
          entry.bot.id === bot.id && entry.target.providerMessageId === actor.providerMessageId,
      );
      if (stillLive) {
        return;
      }
      const target = {
        providerUserId: userId,
        providerMessageId: actor.providerMessageId,
        providerContextToken: actor.providerContextToken,
      };
      await provider.stopTyping(bot, target).catch(() => undefined);
    },
    dispose() {
      for (const taskId of [...live.keys(), ...intervals.keys()]) {
        this.stopTyping(taskId);
      }
    },
  };
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
    {
      resolveZCodeTaskServiceForContext: (item) => resolveZCodeTaskServiceForContext(runtime, item),
      resolveModelSelectionServiceForContext: async () => null,
    },
    context,
    taskId,
  );
  const mode = findSelectConfigOption(options, "mode");
  const supported = resolveSupportedDraftMode(
    options,
    BOT_FORCED_MODE,
    toBotTaskProvider(draft.provider),
  );
  if (mode?.id && supported) {
    await (
      await resolveZCodeTaskServiceForContext(runtime, context)
    ).setMode({
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
  const snapshot = await (
    await resolveZCodeTaskServiceForContext(runtime, context)
  )
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

/** 发布包 host `watchTaskStream`：先广播 bots:task-stream，再处理 elicitation 与终态。 */
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
  const session = createPublishedTaskStreamSession();
  // 发布包 deliveryKind 为 bot-channel-continuous，当前接口映射到 continuous。
  const subscribe = taskService.onDynamicTaskEvent
    ? taskService.onDynamicTaskEvent({
        workspacePath: context.workspacePath,
        workspaceIdentity: context.workspaceIdentity,
        taskId: context.activeTaskId,
        deliveryKind: "continuous",
      })
    : taskService.onDynamicStreamEvent(context.activeTaskId);
  let chain = Promise.resolve();
  const handle = (event: ZCodeStreamEvent, broadcast: boolean): Promise<void> =>
    handlePublishedTaskStreamEvent(
      runtime,
      bot,
      actor,
      context,
      key,
      session,
      taskService,
      event,
      broadcast,
    );
  const sub = subscribe((event: ZCodeStreamEvent) => {
    chain = chain
      .then(() => handle(event, true))
      .catch((error) => {
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
  modelSelection: Parameters<
    NonNullable<BotInboundTaskRuntime["zcodeTaskService"]>["sendPrompt"]
  >[0]["modelSelection"],
): void {
  const botDeliveryTarget = resolveAutomationBotDeliveryTarget(actor);
  resolveZCodeTaskServiceForContext(runtime, context)
    .then((service) =>
      service.sendPrompt({
        taskId,
        traceId,
        content,
        attachments: attachments.length > 0 ? (attachments as never) : undefined,
        ...(botDeliveryTarget ? { botDeliveryTarget } : {}),
        modelSelection,
      }),
    )
    .catch(async (error) => {
      const locale = await runtime.readMessageLocale();
      const message = formatUserFacingBotError(error, locale);
      runtime.runningTasks.delete(taskId);
      runtime.stopTyping(taskId);
      await broadcastTaskListChange(runtime, context, taskId, "error", {
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
  runtime.logger.warn(
    undefined,
    `automation Bot delivery skipped provider=${watch.target.provider} bot=${watch.target.botId} reason=${reason}`,
  );
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

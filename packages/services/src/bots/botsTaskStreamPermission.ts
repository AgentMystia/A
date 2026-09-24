import type {
  BotActor,
  BotConfigEntry,
  BotRuntimeState,
  ZCodePermissionRequest,
} from "@zcode/shared";
import { broadcastTaskListChange } from "./botsBroadcast.js";
import { writeContext } from "./botsContext.js";
import { createSelectionReply } from "./botsInboundDraft.js";
import { shouldUseTransientInteractionCard } from "./botsInboundElicitation.js";
import type { BotInboundTaskRuntime } from "./botsInboundRuntime.js";
import { createOutbound } from "./botsOutbound.js";
import {
  formatBotPermissionOptionDescription,
  formatBotPermissionOptionLabel,
  formatBotPermissionRequestSummary,
  isBotPermissionRejectOption,
  sortBotPermissionOptions,
} from "./botsPermissionFormat.js";
import {
  sealStreamingCardReply,
  type PublishedTaskStreamSession,
} from "./botsStreamingCardSync.js";
import { upsertTransientInteractionCard } from "./botsTransientCards.js";

/** 发布包 host `watchTaskStream` 对 `permission_request` 的处理。 */
export const handleStreamPermissionRequest = (() => {
  return async (
    runtime: BotInboundTaskRuntime,
    bot: BotConfigEntry,
    actor: BotActor,
    context: BotRuntimeState,
    session: PublishedTaskStreamSession,
    event: ZCodePermissionRequest,
  ): Promise<void> => {
    const locale = await runtime.readMessageLocale();
    runtime.stopTyping(event.taskId);
    await sealStreamingCardReply(runtime, bot, actor, context, session);
    await broadcastTaskListChange(runtime, context, event.taskId, "permission_request", {
      permissionRequest: event,
    });
    const options = sortBotPermissionOptions(event.options);
    const pending = options.map((option) => ({
      requestId: event.requestId,
      optionId: option.optionId,
      command: isBotPermissionRejectOption(option) ? ("deny" as const) : ("approve" as const),
      label: formatBotPermissionOptionLabel(option, locale),
      response: option.response,
    }));
    context.pendingPermissionOptions = pending;
    await writeContext(runtime, { ...context, pendingPermissionOptions: pending });
    const [message] = await createSelectionReply(
      runtime,
      actor,
      {
        id: `permission-${event.requestId}`,
        title: formatBotPermissionRequestSummary(event, {
          locale,
          workspacePath: context.workspacePath,
        }),
        action: "permission.respond",
        showCancel: false,
        options: options.map((option) => ({
          id: isBotPermissionRejectOption(option)
            ? `/deny ${event.requestId}`
            : `/approve ${event.requestId} ${option.optionId}`,
          label: formatBotPermissionOptionLabel(option, locale),
          description: formatBotPermissionOptionDescription(option, event, locale),
        })),
      },
      locale,
    );
    if (!message) {
      return;
    }
    const outbound = createOutbound(actor, message.text, message.selection, { locale });
    if (shouldUseTransientInteractionCard(runtime, bot)) {
      await upsertTransientInteractionCard(
        runtime.providers,
        runtime.transientCards,
        bot,
        actor,
        event.taskId,
        outbound,
      );
      return;
    }
    await runtime.sendOutbound(bot, outbound);
  };
})();

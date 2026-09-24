import type { BotInboundMessage, BotOutboundMessage } from "@zcode/shared";
import { copy, getActorContextKey } from "./botsInboundText.js";
import {
  clearPendingSelection,
  createSelectionReply,
  resolvePendingSelectionCommand,
} from "./botsInboundDraft.js";
import { createStatusReply } from "./botsStatusText.js";
import { handleNewCommand } from "./botsInboundCommands.js";
import { handleModelList, handleModelProviderSet, handleModelSet } from "./botsInboundModel.js";
import {
  handlePermissionApprove,
  handlePermissionDeny,
  handlePermissionRespond,
} from "./botsInboundPermission.js";
import { handleStopCommand, handleTaskList, handleTaskSet } from "./botsInboundTask.js";
import { handleThoughtLevelList, handleThoughtLevelSet } from "./botsInboundThought.js";
import { handleWorkspaceList, handleWorkspaceSet } from "./botsInboundWorkspace.js";
import {
  handlePendingElicitationValue,
  handleStructuredElicitationResponse,
  submitPendingElicitation,
} from "./botsInboundElicitation.js";
import { handleMessage } from "./botsInboundMessage.js";
import type { BotInboundTaskRuntime } from "./botsInboundRuntime.js";
import { parseBotCommand } from "./botsParseCommand.js";
import {
  formatReplyGranularityLabel,
  getReplyGranularityOptions,
  parseReplyGranularity,
} from "./botsReply.js";
import { buildBotElicitationContent } from "./botsElicitationParse.js";
import type { createInboundHandlers } from "./botsInbound.js";

// 发布包 host 没有 readStructuredElicitationResponse。函数声明会留下 keepName，箭头常量不会。
const readStructuredElicitation = (
  value: unknown,
): {
  requestId: string;
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
} | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const requestId = typeof record.requestId === "string" ? record.requestId : "";
  const action = record.action;
  if (!requestId || (action !== "accept" && action !== "decline" && action !== "cancel")) {
    return null;
  }
  return {
    requestId,
    action,
    ...(record.content && typeof record.content === "object" && !Array.isArray(record.content)
      ? { content: record.content as Record<string, unknown> }
      : {}),
  };
};

export async function dispatchInboundMessage(
  runtime: BotInboundTaskRuntime,
  inbound: ReturnType<typeof createInboundHandlers>,
  message: BotInboundMessage,
): Promise<BotOutboundMessage[]> {
  if (message.elicitationResponse) {
    const parsed = readStructuredElicitation(message.elicitationResponse);
    return parsed
      ? handleStructuredElicitationResponse(runtime, message, parsed)
      : runtime.replies(
          message.actor,
          copy(await runtime.readMessageLocale(), "elicitationExpired"),
        );
  }
  const parsed = parseBotCommand(message.text);
  const rewritten =
    parsed.type === "message"
      ? (resolvePendingSelectionCommand(runtime, message.actor, parsed.text) ?? parsed)
      : parsed.type === "selection.cancel" &&
          message.actor.provider !== "weixin" &&
          message.text.trim() === "0"
        ? (clearPendingSelection(runtime, message.actor),
          { type: "message" as const, text: message.text })
        : parsed;
  const activated = await inbound.handleWeixinFirstActivation(
    message,
    rewritten.type === "message" ? "message" : rewritten.type,
  );
  if (activated) {
    return activated;
  }
  switch (rewritten.type) {
    case "selection.cancel":
      return handleSelectionCancel(runtime, message);
    case "bind":
      return inbound.handleBind(message, rewritten.code);
    case "help":
      return inbound.handleHelp(message);
    case "status": {
      const authorized = await runtime.withAuthorizedContext(message, "status");
      return authorized.ok
        ? createStatusReply(runtime, message.actor, authorized.context, authorized.locale)
        : authorized.reply;
    }
    case "reconnect":
      return inbound.handleReconnect(message);
    case "new":
      return handleNewCommand(runtime, message);
    case "workspace.list":
      return handleWorkspaceList(runtime, message);
    case "workspace.set":
      return handleWorkspaceSet(runtime, message, rewritten.value);
    case "model.list":
      return handleModelList(runtime, message);
    case "model.provider.set":
      return handleModelProviderSet(runtime, message, rewritten.value);
    case "model.set":
      return handleModelSet(runtime, message, rewritten.value);
    case "mode.list":
    case "mode.set":
      return inbound.handleModeLocked(message);
    case "thoughtLevel.list":
      return handleThoughtLevelList(runtime, message);
    case "thoughtLevel.set":
      return handleThoughtLevelSet(runtime, message, rewritten.value);
    case "task.list":
      return handleTaskList(runtime, message);
    case "task.set":
      return handleTaskSet(runtime, message, rewritten.value);
    case "reply.list": {
      const authorized = await runtime.withAuthorizedContext(message, "reply");
      return authorized.ok
        ? createSelectionReply(
            runtime,
            message.actor,
            {
              id: `reply-${Date.now()}`,
              title: copy(authorized.locale, "replySelectTitle", {
                mode: formatReplyGranularityLabel(
                  authorized.locale,
                  authorized.bot.provider,
                  authorized.bot.replyMode,
                ),
              }),
              currentId: authorized.bot.replyMode,
              action: "reply.set",
              options: getReplyGranularityOptions(authorized.locale, authorized.bot.provider),
            },
            authorized.locale,
          )
        : authorized.reply;
    }
    case "reply.set": {
      const authorized = await runtime.withAuthorizedContext(message, "reply");
      if (!authorized.ok) {
        return authorized.reply;
      }
      const next = parseReplyGranularity(
        rewritten.value,
        authorized.locale,
        authorized.bot.provider,
      );
      if (!next) {
        return runtime.replies(message.actor, copy(authorized.locale, "replyMissing"));
      }
      await runtime.saveBot({ ...authorized.bot, replyMode: next });
      return createStatusReply(runtime, message.actor, authorized.context, authorized.locale);
    }
    case "stop":
      return handleStopCommand(runtime, message);
    case "permission.respond":
      return handlePermissionRespond(runtime, message, rewritten.value);
    case "elicitation.respond": {
      const authorized = await runtime.withAuthorizedContext(message, "message");
      return authorized.ok
        ? handlePendingElicitationValue(runtime, authorized, message.actor, rewritten.value)
        : authorized.reply;
    }
    case "elicitation.submit": {
      const authorized = await runtime.withAuthorizedContext(message, "message");
      if (!authorized.ok) {
        return authorized.reply;
      }
      const pending = authorized.context.pendingElicitation;
      if (!pending) {
        return runtime.replies(message.actor, copy(authorized.locale, "elicitationExpired"));
      }
      if (message.actor.provider !== "weixin") {
        return runtime.replies(message.actor, copy(authorized.locale, "elicitationExpired"));
      }
      return submitPendingElicitation(
        runtime,
        authorized,
        message.actor,
        pending,
        "accept",
        buildBotElicitationContent(pending),
      );
    }
    case "approve":
      return handlePermissionApprove(runtime, message, rewritten.requestId, rewritten.optionId);
    case "deny":
      return handlePermissionDeny(runtime, message, rewritten.requestId);
    case "unknown":
      return inbound.handleUnknown(message, rewritten.name);
    case "message":
      return handleMessage(runtime, message);
  }
}

async function handleSelectionCancel(
  runtime: BotInboundTaskRuntime,
  message: BotInboundMessage,
): Promise<BotOutboundMessage[]> {
  const locale = await runtime.readMessageLocale();
  const key = getActorContextKey(message.actor);
  const pending = runtime.pendingSelections.get(key);
  if (pending?.action === "elicitation.respond") {
    const authorized = await runtime.withAuthorizedContext(message, "message");
    if (!authorized.ok) {
      return authorized.reply;
    }
    const elicitation = authorized.context.pendingElicitation;
    clearPendingSelection(runtime, message.actor);
    return elicitation
      ? submitPendingElicitation(runtime, authorized, message.actor, elicitation, "cancel")
      : runtime.replies(message.actor, copy(authorized.locale, "elicitationExpired"));
  }
  if (!runtime.pendingSelections.has(key)) {
    const authorized = await runtime.withAuthorizedContext(message, "message");
    if (authorized.ok && authorized.context.pendingElicitation) {
      return submitPendingElicitation(
        runtime,
        authorized,
        message.actor,
        authorized.context.pendingElicitation,
        "cancel",
      );
    }
    return runtime.replies(message.actor, copy(locale, "unknownCommand", { command: "0" }));
  }
  clearPendingSelection(runtime, message.actor);
  const authorized = await runtime.withAuthorizedContext(message, "message");
  return authorized.ok
    ? createStatusReply(runtime, message.actor, authorized.context, authorized.locale)
    : authorized.reply;
}

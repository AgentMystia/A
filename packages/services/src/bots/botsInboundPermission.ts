import type { BotInboundMessage, BotOutboundMessage, ZCodePermissionResponse } from "@zcode/shared";
import { writeContext } from "./botsContext.js";
import { copy } from "./botsInboundText.js";
import {
  resolveZCodeTaskServiceForContext,
  type BotInboundTaskRuntime,
} from "./botsInboundRuntime.js";

export const handlePermissionRespond = (() => {
  return async (
    runtime: BotInboundTaskRuntime,
    message: BotInboundMessage,
    value: string,
  ): Promise<BotOutboundMessage[]> => {
    const authorized = await runtime.withAuthorizedContext(message, "approve");
    if (!authorized.ok) {
      return authorized.reply;
    }
    if (!authorized.context.activeTaskId) {
      return runtime.replies(message.actor, copy(authorized.locale, "noActiveTask"));
    }
    const index = Number.parseInt(value, 10) - 1;
    const option = Number.isFinite(index)
      ? authorized.context.pendingPermissionOptions?.[index]
      : undefined;
    if (!option) {
      return runtime.replies(message.actor, copy(authorized.locale, "permissionExpired"));
    }
    if (option.handledAt) {
      return runtime.replies(message.actor, copy(authorized.locale, "permissionHandled"));
    }
    const submitted = await (
      await resolveZCodeTaskServiceForContext(runtime, authorized.context)
    ).respondPermission({
      taskId: authorized.context.activeTaskId,
      requestId: option.requestId,
      optionId: option.optionId,
      response: option.response as ZCodePermissionResponse,
    });
    if (!submitted) {
      return runtime.replies(message.actor, copy(authorized.locale, "permissionHandled"));
    }
    const handledAt = Date.now();
    await writeContext(runtime, {
      ...authorized.context,
      pendingPermissionOptions: authorized.context.pendingPermissionOptions?.map((item) =>
        item.requestId === option.requestId ? { ...item, handledAt } : item,
      ),
    });
    runtime.startTyping(authorized.bot, message.actor, authorized.context.activeTaskId);
    return runtime.replies(
      message.actor,
      copy(
        authorized.locale,
        option.command === "deny" ? "permissionDenied" : "permissionSubmitted",
      ),
    );
  };
})();

export const handlePermissionApprove = (() => {
  return async (
    runtime: BotInboundTaskRuntime,
    message: BotInboundMessage,
    requestId: string,
    optionId: string,
  ): Promise<BotOutboundMessage[]> => {
    const authorized = await runtime.withAuthorizedContext(message, "approve");
    if (!authorized.ok) {
      return authorized.reply;
    }
    if (!authorized.context.activeTaskId) {
      return runtime.replies(message.actor, copy(authorized.locale, "noActiveTask"));
    }
    const option = authorized.context.pendingPermissionOptions?.find(
      (item) => item.requestId === requestId && item.optionId === optionId,
    );
    if (!option) {
      return runtime.replies(message.actor, copy(authorized.locale, "permissionHandled"));
    }
    const submitted = await (
      await resolveZCodeTaskServiceForContext(runtime, authorized.context)
    ).respondPermission({
      taskId: authorized.context.activeTaskId,
      requestId,
      optionId,
      response: option.response as ZCodePermissionResponse,
    });
    if (!submitted) {
      return runtime.replies(message.actor, copy(authorized.locale, "permissionHandled"));
    }
    runtime.startTyping(authorized.bot, message.actor, authorized.context.activeTaskId);
    return runtime.replies(message.actor, copy(authorized.locale, "permissionSubmitted"));
  };
})();

export const handlePermissionDeny = (() => {
  return async (
    runtime: BotInboundTaskRuntime,
    message: BotInboundMessage,
    requestId: string,
  ): Promise<BotOutboundMessage[]> => {
    const authorized = await runtime.withAuthorizedContext(message, "approve");
    if (!authorized.ok) {
      return authorized.reply;
    }
    if (!authorized.context.activeTaskId) {
      return runtime.replies(message.actor, copy(authorized.locale, "noActiveTask"));
    }
    const option = authorized.context.pendingPermissionOptions?.find(
      (item) => item.requestId === requestId && item.command === "deny",
    );
    const submitted = await (
      await resolveZCodeTaskServiceForContext(runtime, authorized.context)
    ).respondPermission({
      taskId: authorized.context.activeTaskId,
      requestId,
      optionId: "deny",
      response: (option?.response ?? {
        decision: "deny",
        reason: "Denied by bot command",
      }) as ZCodePermissionResponse,
    });
    if (!submitted) {
      return runtime.replies(message.actor, copy(authorized.locale, "permissionHandled"));
    }
    runtime.startTyping(authorized.bot, message.actor, authorized.context.activeTaskId);
    return runtime.replies(message.actor, copy(authorized.locale, "permissionDenied"));
  };
})();

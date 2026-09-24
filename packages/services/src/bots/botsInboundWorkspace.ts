import type { BotInboundMessage, BotOutboundMessage } from "@zcode/shared";
import { copy, getActorContextKey } from "./botsInboundText.js";
import { formatWorkspaceOptionLabel } from "./botsHostHelpers.js";
import {
  createSelectionReply,
  resolvePendingWorkspaceSelectionEntry,
  writeDraftContext,
} from "./botsInboundDraft.js";
import { createStatusReply } from "./botsStatusText.js";
import { createCurrentWorkspaceRef, type BotInboundTaskRuntime } from "./botsInboundRuntime.js";
import { filterAllowedWorkspaces, resolveWorkspaceByValue } from "./botsNormalize.js";
import { isContextActiveTaskRunning } from "./botsTaskStream.js";
import { buildInitializedDraft, normalizeBotWorkspaceConfig } from "./botsInboundCommands.js";

export const handleWorkspaceList = (() => {
  return async (
    runtime: BotInboundTaskRuntime,
    message: BotInboundMessage,
  ): Promise<BotOutboundMessage[]> => {
    const authorized = await runtime.withAuthorizedContext(message, "workspace");
    if (!authorized.ok) {
      return authorized.reply;
    }
    if (await isContextActiveTaskRunning(runtime, authorized.context)) {
      return runtime.replies(message.actor, copy(authorized.locale, "taskRunning"));
    }
    const normalized = await normalizeBotWorkspaceConfig(
      runtime,
      authorized.config,
      authorized.bot,
      createCurrentWorkspaceRef(authorized.context),
    );
    const listed = filterAllowedWorkspaces(
      normalized.workspaces,
      normalized.user.allowedWorkspaces,
    );
    if (listed.length === 0) {
      runtime.workspaceSelectionEntries.delete(getActorContextKey(message.actor));
      return runtime.replies(message.actor, copy(authorized.locale, "workspaceMissing"));
    }
    runtime.workspaceSelectionEntries.set(
      getActorContextKey(message.actor),
      new Map(listed.map((item) => [item.id, { workspace: item }])),
    );
    return createSelectionReply(
      runtime,
      message.actor,
      {
        id: `workspace-${Date.now()}`,
        title: copy(authorized.locale, "workspaceSelectTitle", {
          workspace:
            listed.find((item) => item.id === authorized.context.workspaceId)?.label ??
            authorized.context.workspacePath,
        }),
        currentId: authorized.context.workspaceId,
        action: "workspace.set",
        options: listed.map((item) => ({
          id: item.id,
          label: formatWorkspaceOptionLabel(item, authorized.locale),
        })),
      },
      authorized.locale,
    );
  };
})();

export const handleWorkspaceSet = (() => {
  return async (
    runtime: BotInboundTaskRuntime,
    message: BotInboundMessage,
    value: string,
  ): Promise<BotOutboundMessage[]> => {
    const authorized = await runtime.withAuthorizedContext(message, "workspace");
    if (!authorized.ok) {
      return authorized.reply;
    }
    if (await isContextActiveTaskRunning(runtime, authorized.context)) {
      return runtime.replies(message.actor, copy(authorized.locale, "taskRunning"));
    }
    const normalized = await normalizeBotWorkspaceConfig(
      runtime,
      authorized.config,
      authorized.bot,
      createCurrentWorkspaceRef(authorized.context),
    );
    const selected =
      resolvePendingWorkspaceSelectionEntry(runtime, message.actor, value)?.workspace ??
      resolveWorkspaceByValue(normalized.workspaces, value, normalized.user.allowedWorkspaces);
    if (!selected) {
      return runtime.replies(message.actor, copy(authorized.locale, "workspaceMissing"));
    }
    const next = await writeDraftContext(
      runtime,
      {
        ...authorized.context,
        workspacePath: selected.workspacePath,
        workspaceIdentity: selected.workspaceIdentity,
        workspaceId: selected.id,
      },
      await buildInitializedDraft(runtime, selected),
    );
    runtime.workspaceSelectionEntries.delete(getActorContextKey(message.actor));
    return createStatusReply(runtime, message.actor, next, authorized.locale);
  };
})();

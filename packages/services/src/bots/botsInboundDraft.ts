import type {
  BotActor,
  BotDraftOptions,
  BotInboundMessage,
  BotOutboundMessage,
  BotRuntimeState,
  BotWorkspaceRef,
  ZCodeTaskMeta,
} from "@zcode/shared";
import { isRemoteWorkspaceConnected, writeContext } from "./botsContext.js";
import { BOT_FORCED_MODE } from "./botsConstants.js";
import { copy, getActorContextKey } from "./botsInboundText.js";
import {
  buildInitializedDraftOptions,
  listActiveTaskConfigOptions,
  listDraftConfigOptions,
  readConfigSelectCurrentValue,
  readCurrentActiveTaskModel,
  readModelSelectionView,
  resolveSupportedDraftMode,
  parseBotModelOptionValue,
  toBotTaskProvider,
} from "./botsDraft.js";
import {
  formatWorkspaceOptionLabel,
  isSelectionIndexValue,
  normalizeBotDraftOptions,
  resolveOptionByValue,
  stripModelProviderDescriptionsForTextSelection,
} from "./botsHostHelpers.js";
import {
  resolveZCodeTaskServiceForContext,
  type BotContextTaskEntry,
  type BotInboundTaskRuntime,
} from "./botsInboundRuntime.js";
import { createWorkspaceRef, filterAllowedWorkspaces, getWorkspaceKey } from "./botsNormalize.js";
import { currentOptionSuffix } from "./botsReply.js";
import type { BotMessageLocale } from "./botsCopy.js";
import type { ParsedBotCommand } from "./botsParseCommand.js";
import type { BotSelection } from "./botsTypes.js";
import type { AuthorizedContext } from "./botsInbound.js";

/** 发布包 host `writeDraftContext`。 */
export async function writeDraftContext(
  runtime: BotInboundTaskRuntime,
  context: BotRuntimeState,
  draftOptions?: BotDraftOptions,
): Promise<BotRuntimeState> {
  const next: BotRuntimeState = {
    ...context,
    mode: "draft",
    activeTaskId: null,
    draftOptions,
    pendingPermissionOptions: undefined,
    pendingElicitation: undefined,
  };
  clearPendingSelectionsForBot(runtime, context.botId);
  return writeContext(runtime, next);
}

export function clearPendingSelectionsForBot(runtime: BotInboundTaskRuntime, botId: string): void {
  const matches = (key: string) => key === botId || key.startsWith(`${botId}::`);
  for (const key of runtime.pendingSelections.keys()) {
    if (matches(key)) runtime.pendingSelections.delete(key);
  }
  for (const key of runtime.taskSelectionEntries.keys()) {
    if (matches(key)) runtime.taskSelectionEntries.delete(key);
  }
  for (const key of runtime.workspaceSelectionEntries.keys()) {
    if (matches(key)) runtime.workspaceSelectionEntries.delete(key);
  }
}

export function clearPendingSelection(runtime: BotInboundTaskRuntime, actor: BotActor): void {
  const key = getActorContextKey(actor);
  runtime.pendingSelections.delete(key);
  runtime.taskSelectionEntries.delete(key);
  runtime.workspaceSelectionEntries.delete(key);
}

export function resolvePendingSelectionOption(
  runtime: BotInboundTaskRuntime,
  actor: BotActor,
  action: string,
  value: string,
): { id: string; label: string } | null {
  const key = getActorContextKey(actor);
  const pending = runtime.pendingSelections.get(key);
  if (pending?.action !== action) {
    return null;
  }
  const option = resolveOptionByValue(pending.options, value);
  if (option) {
    runtime.pendingSelections.delete(key);
  }
  return option;
}

/** 发布包 host `resolvePendingSelectionCommand`：微信数字回复改写为对应 action。 */
export function resolvePendingSelectionCommand(
  runtime: BotInboundTaskRuntime,
  actor: BotActor,
  text: string,
): ParsedBotCommand | null {
  const pending = runtime.pendingSelections.get(getActorContextKey(actor));
  if (!pending) {
    return null;
  }
  if (actor.provider !== "weixin" || !isSelectionIndexValue(text)) {
    clearPendingSelection(runtime, actor);
    return null;
  }
  const option = resolveOptionByValue(pending.options, text);
  if (!option) {
    clearPendingSelection(runtime, actor);
    return null;
  }
  runtime.pendingSelections.delete(getActorContextKey(actor));
  switch (pending.action) {
    case "workspace.set":
    case "model.provider.set":
    case "model.set":
    case "mode.set":
    case "thoughtLevel.set":
    case "task.set":
    case "reply.set":
      return { type: pending.action, value: option.id };
    case "permission.respond":
      return { type: "permission.respond", value: text };
    case "elicitation.respond":
      return { type: "elicitation.respond", value: option.id };
    default:
      return null;
  }
}

export async function createSelectionReply(
  runtime: BotInboundTaskRuntime,
  actor: BotActor,
  selection: BotSelection,
  locale: BotMessageLocale,
  extra?: Parameters<BotInboundTaskRuntime["replies"]>[4],
): Promise<BotOutboundMessage[]> {
  const marked = markCurrentSelection(selection, locale);
  const useStructured = actor.provider !== "weixin";
  const stored = useStructured
    ? marked
    : {
        ...stripModelProviderDescriptionsForTextSelection(marked),
        cancelLabel: marked.cancelLabel,
      };
  runtime.pendingSelections.set(getActorContextKey(actor), stored);
  const text = useStructured ? stored.title : formatNumberedSelection(stored, locale);
  return runtime.replies(actor, text, locale, useStructured ? stored : undefined, extra);
}

function markCurrentSelection(selection: BotSelection, locale: BotMessageLocale): BotSelection {
  const cancelLabel = copy(locale, "selectionCancelOption");
  if (!selection.currentId) {
    return { ...selection, cancelLabel };
  }
  const suffix = currentOptionSuffix(locale);
  return {
    ...selection,
    cancelLabel,
    options: selection.options.map((option) =>
      option.id === selection.currentId
        ? { ...option, label: `${option.label} · ${suffix}` }
        : option,
    ),
  };
}

function formatNumberedSelection(selection: BotSelection, locale: BotMessageLocale): string {
  const lines = selection.options.map((option, index) => {
    const description = option.description ? ` ${option.description}` : "";
    return `${index + 1}. ${option.label}${description}`;
  });
  if (selection.showCancel === false) {
    return `${selection.title}\n${lines.join("\n")}\n\n${copy(locale, "selectionTextHintNoCancel")}`;
  }
  const cancel = selection.cancelLabel ?? copy(locale, "selectionCancelOption");
  return `${selection.title}\n0. ${cancel}\n${lines.join("\n")}\n\n${copy(locale, "selectionTextHint")}`;
}

export async function ensureDraftOptions(
  runtime: BotInboundTaskRuntime,
  context: BotRuntimeState,
): Promise<BotDraftOptions> {
  if (context.draftOptions) {
    const normalized = normalizeBotDraftOptions(context.draftOptions);
    if (normalized.provider !== context.draftOptions.provider) {
      await writeContext(runtime, { ...context, draftOptions: normalized });
    }
    return normalized;
  }
  const draft = await buildInitializedDraftOptions(context, (item) =>
    isRemoteWorkspaceConnected(runtime, item),
  );
  await writeContext(runtime, { ...context, draftOptions: draft });
  return draft;
}

export async function writeDraftOptions(
  runtime: BotInboundTaskRuntime,
  context: BotRuntimeState,
  draft: BotDraftOptions,
): Promise<BotRuntimeState> {
  return writeContext(runtime, {
    ...context,
    mode: "draft",
    activeTaskId: null,
    draftOptions: normalizeBotDraftOptions(draft),
  });
}

export async function resolveDraftOptionsForDisplay(
  runtime: BotInboundTaskRuntime,
  context: BotRuntimeState,
): Promise<BotDraftOptions> {
  const draft = await ensureDraftOptions(runtime, context);
  const view = await readModelSelectionView(runtime, context, draft.modelSelection);
  return {
    ...draft,
    modelSelection:
      (draft.modelSelection ? view?.effectiveSelection : view?.preferredSelection) ?? undefined,
  };
}

export async function buildActiveTaskDraftOptions(
  runtime: BotInboundTaskRuntime,
  context: BotRuntimeState,
): Promise<BotDraftOptions> {
  if (!context.activeTaskId) {
    return buildInitializedDraftOptions(context, (item) =>
      isRemoteWorkspaceConnected(runtime, item),
    );
  }
  const meta = await readContextActiveTaskMeta(runtime, context);
  if (!meta?.provider) {
    return buildInitializedDraftOptions(context, (item) =>
      isRemoteWorkspaceConnected(runtime, item),
    );
  }
  const options = await listActiveTaskConfigOptions(runtime, context, context.activeTaskId).catch(
    () => [],
  );
  const provider = toBotTaskProvider(meta.provider);
  const mode = resolveSupportedDraftMode(options, BOT_FORCED_MODE, provider);
  const modelValue = readCurrentActiveTaskModel(meta, options);
  const parsed = modelValue ? parseBotModelOptionValue(modelValue) : undefined;
  const thought = readConfigSelectCurrentValue(options, "thoughtLevel");
  const modelSelection = parsed
    ? { ...parsed, ...(thought ? { options: { reasoningLevel: thought } } : {}) }
    : undefined;
  return {
    provider,
    ...(modelSelection ? { modelSelection } : {}),
    ...(mode ? { mode } : {}),
  };
}

export async function readContextActiveTaskMeta(
  runtime: BotInboundTaskRuntime,
  context: BotRuntimeState,
): Promise<ZCodeTaskMeta | null> {
  if (!context.activeTaskId) {
    return null;
  }
  try {
    const listed = await (
      await resolveZCodeTaskServiceForContext(runtime, context)
    ).listTasks({
      workspacePath: context.workspacePath,
      workspaceIdentity: context.workspaceIdentity,
    });
    const found = listed.find((item) => item.taskId === context.activeTaskId);
    if (found) {
      return found;
    }
  } catch {
    /* 列表失败时退到 snapshot.meta，与发布包 keepNames 一致。 */
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
  return snapshot?.meta ?? null;
}

export function resolvePendingWorkspaceSelectionEntry(
  runtime: BotInboundTaskRuntime,
  actor: BotActor,
  value: string,
): { workspace: BotWorkspaceRef } | null {
  const key = getActorContextKey(actor);
  const direct = runtime.workspaceSelectionEntries.get(key)?.get(value.trim());
  if (direct) {
    return direct;
  }
  const option = resolvePendingSelectionOption(runtime, actor, "workspace.set", value);
  return option ? (runtime.workspaceSelectionEntries.get(key)?.get(option.id) ?? null) : null;
}

export function resolvePendingTaskSelectionEntry(
  runtime: BotInboundTaskRuntime,
  actor: BotActor,
  value: string,
): BotContextTaskEntry | null {
  const key = getActorContextKey(actor);
  const direct = runtime.taskSelectionEntries.get(key)?.get(value.trim());
  if (direct) {
    return direct;
  }
  const option = resolvePendingSelectionOption(runtime, actor, "task.set", value);
  return option ? (runtime.taskSelectionEntries.get(key)?.get(option.id) ?? null) : null;
}

export {
  formatWorkspaceOptionLabel,
  currentOptionSuffix,
  createWorkspaceRef,
  getWorkspaceKey,
  filterAllowedWorkspaces,
  listDraftConfigOptions,
};
export type { BotSelection, AuthorizedContext, BotInboundMessage };

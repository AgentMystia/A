import type { BotInboundMessage, BotOutboundMessage } from "@zcode/shared";
import { copy } from "./botsInboundText.js";
import {
  listDraftConfigOptions,
  listConfigSelectOptions,
  readConfigSelectCurrentValue,
  readConfigSelectLabelForValue,
  readModelSelectionView,
  toBotTaskProvider,
} from "./botsDraft.js";
import { createBotTraceId, resolveOptionByValue } from "./botsHostHelpers.js";
import {
  createSelectionReply,
  createStatusReply,
  ensureDraftOptions,
  resolvePendingSelectionOption,
  writeDraftOptions,
} from "./botsInboundDraft.js";
import {
  createTaskServiceResolver,
  resolveZCodeTaskServiceForContext,
  type BotInboundTaskRuntime,
} from "./botsInboundRuntime.js";
import { isContextActiveTaskRunning } from "./botsTaskStream.js";
import { requireActiveTask } from "./botsInboundCommands.js";

export async function handleThoughtLevelList(
  runtime: BotInboundTaskRuntime,
  message: BotInboundMessage,
): Promise<BotOutboundMessage[]> {
  const authorized = await runtime.withAuthorizedContext(message, "thoughtLevel");
  if (!authorized.ok) {
    return authorized.reply;
  }
  if (await isContextActiveTaskRunning(runtime, authorized.context)) {
    return runtime.replies(message.actor, copy(authorized.locale, "taskRunning"));
  }
  const resolver = createTaskServiceResolver(runtime);
  if (authorized.context.mode === "draft" || !authorized.context.activeTaskId) {
    const draft = await ensureDraftOptions(runtime, authorized.context);
    const options = await listDraftConfigOptions(resolver, authorized.context, draft);
    const listed = listConfigSelectOptions(options, "thoughtLevel", {
      locale: authorized.locale,
      provider: draft.provider,
    });
    if (listed.length === 0) {
      return runtime.replies(message.actor, copy(authorized.locale, "thoughtLevelMissing"));
    }
    const current = readConfigSelectCurrentValue(options, "thoughtLevel");
    return createSelectionReply(
      runtime,
      message.actor,
      {
        id: `thoughtLevel-${Date.now()}`,
        title: copy(authorized.locale, "thoughtLevelSelectTitle", {
          level:
            readConfigSelectLabelForValue(options, "thoughtLevel", current, {
              locale: authorized.locale,
              provider: draft.provider,
            }) ?? "-",
        }),
        currentId: current,
        action: "thoughtLevel.set",
        options: listed,
      },
      authorized.locale,
    );
  }
  const active = await requireActiveTask(runtime, message, authorized);
  if (!active.ok) {
    return active.reply;
  }
  const listed = listConfigSelectOptions(active.configOptions, "thoughtLevel", {
    locale: authorized.locale,
    provider: toBotTaskProvider(active.task.provider),
  });
  if (listed.length === 0) {
    return runtime.replies(message.actor, copy(authorized.locale, "thoughtLevelMissing"));
  }
  const current = readConfigSelectCurrentValue(active.configOptions, "thoughtLevel");
  return createSelectionReply(
    runtime,
    message.actor,
    {
      id: `thoughtLevel-${Date.now()}`,
      title: copy(authorized.locale, "thoughtLevelSelectTitle", { level: current ?? "-" }),
      currentId: current,
      action: "thoughtLevel.set",
      options: listed,
    },
    authorized.locale,
  );
}

export async function handleThoughtLevelSet(
  runtime: BotInboundTaskRuntime,
  message: BotInboundMessage,
  value: string,
): Promise<BotOutboundMessage[]> {
  const authorized = await runtime.withAuthorizedContext(message, "thoughtLevel");
  if (!authorized.ok) {
    return authorized.reply;
  }
  if (await isContextActiveTaskRunning(runtime, authorized.context)) {
    return runtime.replies(message.actor, copy(authorized.locale, "taskRunning"));
  }
  const resolver = createTaskServiceResolver(runtime);
  if (authorized.context.mode === "draft" || !authorized.context.activeTaskId) {
    const draft = await ensureDraftOptions(runtime, authorized.context);
    const view = await readModelSelectionView(resolver, authorized.context, draft.modelSelection);
    const options = await listDraftConfigOptions(resolver, authorized.context, draft, view);
    const listed = listConfigSelectOptions(options, "thoughtLevel", {
      locale: authorized.locale,
      provider: draft.provider,
    });
    const selected =
      resolvePendingSelectionOption(runtime, message.actor, "thoughtLevel.set", value) ??
      resolveOptionByValue(listed, value);
    if (!selected || !listed.some((item) => item.id === selected.id)) {
      return runtime.replies(message.actor, copy(authorized.locale, "thoughtLevelMissing"));
    }
    const selection = (draft.modelSelection ? view?.effectiveSelection : view?.preferredSelection) ?? undefined;
    const next = await writeDraftOptions(runtime, authorized.context, {
      ...draft,
      modelSelection: selection
        ? { ...selection, options: { ...selection.options, reasoningLevel: selected.id } }
        : draft.modelSelection,
    });
    return createStatusReply(runtime, message.actor, next, authorized.locale);
  }
  const active = await requireActiveTask(runtime, message, authorized);
  if (!active.ok) {
    return active.reply;
  }
  const listed = listConfigSelectOptions(active.configOptions, "thoughtLevel", {
    locale: authorized.locale,
    provider: active.task.provider,
  });
  const selected =
    resolvePendingSelectionOption(runtime, message.actor, "thoughtLevel.set", value) ??
    resolveOptionByValue(listed, value);
  const option = active.configOptions.find((item) => item.category === "thought_level" || item.id === "thought_level");
  if (!selected || !option?.id) {
    return runtime.replies(message.actor, copy(authorized.locale, "thoughtLevelMissing"));
  }
  await (
    await resolveZCodeTaskServiceForContext(runtime, authorized.context)
  ).setConfigOption({
    taskId: active.taskId,
    traceId: createBotTraceId(active.taskId),
    configId: option.id,
    value: selected.id,
  });
  return createStatusReply(runtime, message.actor, authorized.context, authorized.locale);
}

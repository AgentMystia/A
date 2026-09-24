import type {
  BotInboundMessage,
  BotOutboundMessage,
  ZCodeConfigOption,
  ZCodeTaskMeta,
} from "@zcode/shared";
import { decodeCustomModelValue } from "@zcode/shared";
import { copy } from "./botsInboundText.js";
import {
  completeBotModelSelection,
  formatStatusModelLabel,
  listAllModelOptionsForActiveTask,
  listModelOptionsForProviderFromActiveTask,
  listModelProviderOptionsForActiveTask,
  readCurrentActiveTaskModel,
  readCurrentModelProviderId,
  readModelProviderSelectionModels,
  readModelSelectionView,
  formatBotModelSelectionValue,
  parseBotModelOptionValue,
  resolveCustomModelRuntimeModelId,
  toBotTaskProvider,
} from "./botsDraft.js";
import { createBotTraceId, resolveOptionByValue } from "./botsHostHelpers.js";
import {
  createSelectionReply,
  ensureDraftOptions,
  resolveDraftOptionsForDisplay,
  resolvePendingSelectionOption,
  writeDraftOptions,
} from "./botsInboundDraft.js";
import { createStatusReply } from "./botsStatusText.js";
import {
  resolveZCodeTaskServiceForContext,
  type BotInboundTaskRuntime,
} from "./botsInboundRuntime.js";
import { isContextActiveTaskRunning } from "./botsTaskStream.js";
import { requireActiveTask } from "./botsInboundCommands.js";

export async function handleModelList(
  runtime: BotInboundTaskRuntime,
  message: BotInboundMessage,
): Promise<BotOutboundMessage[]> {
  const authorized = await runtime.withAuthorizedContext(message, "model");
  if (!authorized.ok) {
    return authorized.reply;
  }
  if (await isContextActiveTaskRunning(runtime, authorized.context)) {
    return runtime.replies(message.actor, copy(authorized.locale, "taskRunning"));
  }
  const resolver = runtime;
  if (authorized.context.mode === "draft" || !authorized.context.activeTaskId) {
    const draft = await resolveDraftOptionsForDisplay(runtime, authorized.context);
    const providers = await listModelProviderOptionsForActiveTask(resolver, authorized.context);
    if (providers.length === 0) {
      return runtime.replies(message.actor, copy(authorized.locale, "modelProviderMissing"));
    }
    const currentId = await readCurrentModelProviderId(
      resolver,
      { model: formatBotModelSelectionValue(draft.modelSelection) },
      [],
      draft.provider,
      authorized.context,
    );
    return createSelectionReply(
      runtime,
      message.actor,
      {
        id: `model-${Date.now()}`,
        title: copy(authorized.locale, "modelProviderSelectTitle", {
          model: await formatStatusModelLabel(
            resolver,
            formatBotModelSelectionValue(draft.modelSelection),
            authorized.context,
          ),
        }),
        currentId,
        action: "model.provider.set",
        options: providers,
      },
      authorized.locale,
    );
  }
  const active = await requireActiveTask(runtime, message, authorized);
  if (!active.ok) {
    return active.reply;
  }
  const provider = toBotTaskProvider(active.task.provider);
  const providers = await listModelProviderOptionsForActiveTask(resolver, active.task);
  if (providers.length === 0) {
    return runtime.replies(message.actor, copy(authorized.locale, "modelProviderMissing"));
  }
  const currentModel = readCurrentActiveTaskModel(active.task, active.configOptions);
  return createSelectionReply(
    runtime,
    message.actor,
    {
      id: `model-${Date.now()}`,
      title: copy(authorized.locale, "modelProviderSelectTitle", {
        model: await formatStatusModelLabel(resolver, currentModel, active.task),
      }),
      currentId: await readCurrentModelProviderId(
        resolver,
        active.task,
        active.configOptions,
        provider,
        active.task,
      ),
      action: "model.provider.set",
      options: providers,
    },
    authorized.locale,
  );
}

export async function handleModelProviderSet(
  runtime: BotInboundTaskRuntime,
  message: BotInboundMessage,
  value: string,
): Promise<BotOutboundMessage[]> {
  const authorized = await runtime.withAuthorizedContext(message, "model");
  if (!authorized.ok) {
    return authorized.reply;
  }
  if (await isContextActiveTaskRunning(runtime, authorized.context)) {
    return runtime.replies(message.actor, copy(authorized.locale, "taskRunning"));
  }
  const resolver = runtime;
  const isDraft = authorized.context.mode === "draft" || !authorized.context.activeTaskId;
  const draft = isDraft ? await resolveDraftOptionsForDisplay(runtime, authorized.context) : null;
  const active = isDraft ? null : await requireActiveTask(runtime, message, authorized);
  if (active && !active.ok) {
    return active.reply;
  }
  const task = isDraft ? authorized.context : (active as { task: ZCodeTaskMeta }).task;
  const providers = await listModelProviderOptionsForActiveTask(resolver, task);
  const selected =
    resolvePendingSelectionOption(runtime, message.actor, "model.provider.set", value) ??
    resolveOptionByValue(providers, value);
  if (!selected) {
    return runtime.replies(message.actor, copy(authorized.locale, "modelProviderMissing"));
  }
  const models =
    readModelProviderSelectionModels(selected).length > 0
      ? readModelProviderSelectionModels(selected)
      : await listModelOptionsForProviderFromActiveTask(resolver, task, selected.id);
  if (models.length === 0) {
    return runtime.replies(message.actor, copy(authorized.locale, "modelMissing"));
  }
  const currentModel = isDraft
    ? formatBotModelSelectionValue(draft?.modelSelection)
    : readCurrentActiveTaskModel(
        (active as { task: ZCodeTaskMeta }).task,
        (active as { configOptions: ZCodeConfigOption[] }).configOptions,
      );
  return createSelectionReply(
    runtime,
    message.actor,
    {
      id: `model-${Date.now()}`,
      title: copy(authorized.locale, "modelModelSelectTitle", { model: currentModel ?? "-" }),
      currentId: models.some((item) => item.id === currentModel) ? currentModel : undefined,
      action: "model.set",
      options: models,
    },
    authorized.locale,
  );
}

export async function handleModelSet(
  runtime: BotInboundTaskRuntime,
  message: BotInboundMessage,
  value: string,
): Promise<BotOutboundMessage[]> {
  const authorized = await runtime.withAuthorizedContext(message, "model");
  if (!authorized.ok) {
    return authorized.reply;
  }
  if (await isContextActiveTaskRunning(runtime, authorized.context)) {
    return runtime.replies(message.actor, copy(authorized.locale, "taskRunning"));
  }
  const resolver = runtime;
  if (authorized.context.mode === "draft" || !authorized.context.activeTaskId) {
    const draft = await ensureDraftOptions(runtime, authorized.context);
    const option =
      resolvePendingSelectionOption(runtime, message.actor, "model.set", value) ??
      resolveOptionByValue(
        await listAllModelOptionsForActiveTask(resolver, authorized.context),
        value,
      );
    if (!option) {
      return runtime.replies(message.actor, copy(authorized.locale, "modelMissing"));
    }
    const parsed = parseBotModelOptionValue(option.id);
    const view = await readModelSelectionView(resolver, authorized.context);
    const completed = view && parsed ? completeBotModelSelection(view, parsed) : undefined;
    if (!completed) {
      return runtime.replies(message.actor, copy(authorized.locale, "modelMissing"));
    }
    const next = await writeDraftOptions(runtime, authorized.context, {
      ...draft,
      modelSelection: completed,
    });
    return createStatusReply(runtime, message.actor, next, authorized.locale);
  }
  const active = await requireActiveTask(runtime, message, authorized);
  if (!active.ok) {
    return active.reply;
  }
  const provider = toBotTaskProvider(active.task.provider);
  const option =
    resolvePendingSelectionOption(runtime, message.actor, "model.set", value) ??
    resolveOptionByValue(await listAllModelOptionsForActiveTask(resolver, active.task), value);
  if (!option) {
    return runtime.replies(message.actor, copy(authorized.locale, "modelMissing"));
  }
  const custom = decodeCustomModelValue(option.id);
  const modelId = custom ? resolveCustomModelRuntimeModelId(provider, custom) : option.id;
  if (!modelId) {
    return runtime.replies(message.actor, copy(authorized.locale, "modelMissing"));
  }
  const selection = custom?.modelName
    ? { providerId: custom.providerId, modelId: custom.modelName }
    : { providerId: provider, modelId };
  const view = await readModelSelectionView(resolver, active.task);
  const completed = view ? completeBotModelSelection(view, selection) : undefined;
  if (!completed) {
    return runtime.replies(message.actor, copy(authorized.locale, "modelMissing"));
  }
  await (
    await resolveZCodeTaskServiceForContext(runtime, authorized.context)
  ).setModel({
    taskId: active.taskId,
    traceId: createBotTraceId(active.taskId),
    modelSelection: completed,
  });
  return createStatusReply(runtime, message.actor, authorized.context, authorized.locale);
}

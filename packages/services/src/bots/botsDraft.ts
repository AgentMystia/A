import { completeNewModelSelection } from "@zcode/provider";
import type {
  BotDraftOptions,
  ModelSelection,
  ZCodeConfigOption,
  ZCodeTaskMeta,
} from "@zcode/shared";
import { BOT_FORCED_MODE, DEFAULT_DRAFT_PROVIDER } from "./botsConstants.js";
import {
  formatBotModelSelectionValue,
  resolveProviderModeIdFromConfigOptions,
  getConfigCommandMissingMessageId,
  getNativeModelProviderId,
  parseBotModelOptionValue,
  resolveCustomModelRuntimeModelId,
  toBotTaskProvider,
  type BotTaskProvider,
} from "./botsHostHelpers.js";
import type { BotMessageLocale } from "./botsCopy.js";
import { copy } from "./botsInboundText.js";
import type { IModelSelectionService } from "../model-provider/providerFacadeServices.js";
import type { IZCodeTaskService } from "../session/zcodeTaskService.js";
import type { BotSelectionOption } from "./botsTypes.js";

export interface BotDraftWorkspace {
  workspacePath: string;
  workspaceIdentity?: string;
}

export interface BotTaskServiceResolver {
  resolveZCodeTaskServiceForContext(context: BotDraftWorkspace): Promise<IZCodeTaskService>;
  resolveModelSelectionServiceForContext(
    context: BotDraftWorkspace,
  ): Promise<IModelSelectionService | null>;
}

const MODE_DISPLAY: Record<string, Record<string, Record<string, string>>> = {
  claude: {
    auto: { "en-US": "Auto", "zh-CN": "自动" },
    default: { "en-US": "Default", "zh-CN": "默认" },
    acceptEdits: { "en-US": "Accept Edits", "zh-CN": "接受编辑" },
    plan: { "en-US": "Plan", "zh-CN": "计划" },
    dontAsk: { "en-US": "Don't Ask", "zh-CN": "无需询问" },
    bypassPermissions: { "en-US": "Bypass Permissions", "zh-CN": "绕过权限" },
  },
  codex: {
    "read-only": { "en-US": "Read Only", "zh-CN": "只读模式" },
    auto: { "en-US": "Auto Edit", "zh-CN": "自动编辑模式" },
    agent: { "en-US": "Agent", "zh-CN": "Agent 模式" },
    "full-access": { "en-US": "Full Access", "zh-CN": "全权限模式" },
    "agent-full-access": { "en-US": "Agent (Full Access)", "zh-CN": "全权限模式" },
  },
  gemini: {
    default: { "en-US": "Default", "zh-CN": "默认" },
    autoEdit: { "en-US": "Auto Edit", "zh-CN": "自动编辑" },
    yolo: { "en-US": "Yolo", "zh-CN": "Yolo" },
    plan: { "en-US": "Plan", "zh-CN": "计划" },
  },
  opencode: {
    build: { "en-US": "Build", "zh-CN": "构建" },
    plan: { "en-US": "Plan", "zh-CN": "计划" },
  },
  glm: {
    default: { "en-US": "Default", "zh-CN": "默认" },
    yolo: { "en-US": "Yolo", "zh-CN": "Yolo" },
    plan: { "en-US": "Plan", "zh-CN": "计划" },
  },
};

export function findSelectConfigOption(
  options: ZCodeConfigOption[],
  configId: string,
): ZCodeConfigOption | undefined {
  const category = configId === "thoughtLevel" ? "thought_level" : configId;
  return options.find(
    (option) =>
      option.type === "select" && (option.category === category || option.id === category),
  );
}

export function getModeDisplayLabel(
  locale: BotMessageLocale,
  provider: string | undefined,
  option: { id: string; label: string },
): string {
  if (!provider) {
    return option.label;
  }
  return MODE_DISPLAY[provider]?.[option.id]?.[locale] ?? option.label;
}

export function formatConfigOptionLabel(
  option: { id: string; label: string },
  input: { configId: string; locale: BotMessageLocale; provider?: string },
): string {
  return input.configId !== "mode"
    ? option.label
    : getModeDisplayLabel(input.locale, input.provider, option);
}

export function listConfigSelectOptions(
  options: ZCodeConfigOption[],
  configId: string,
  input: { locale: BotMessageLocale; provider?: string } = { locale: "zh-CN" },
): BotSelectionOption[] {
  return (findSelectConfigOption(options, configId)?.options ?? []).map((item) => {
    const option = { id: item.value, label: item.name, description: item.description };
    return {
      ...option,
      label: formatConfigOptionLabel(option, {
        configId,
        locale: input.locale,
        provider: input.provider,
      }),
    };
  });
}

export function readConfigSelectCurrentValue(
  options: ZCodeConfigOption[],
  configId: string,
): string | undefined {
  const current = findSelectConfigOption(options, configId)?.currentValue;
  return typeof current === "string" ? current : undefined;
}

/** 发布包 host `readConfigSelectLabelForValue`。 */
export function readConfigSelectLabelForValue(
  options: ZCodeConfigOption[],
  configId: string,
  value: string | undefined,
  input: { locale: BotMessageLocale; provider?: string } = { locale: "zh-CN" },
): string | undefined {
  if (!value) {
    return undefined;
  }
  return (
    listConfigSelectOptions(options, configId, input).find((item) => item.id === value)?.label ??
    value
  );
}

/** 发布包 host `readConfigSelectCurrentLabel`。 */
export function readConfigSelectCurrentLabel(
  options: ZCodeConfigOption[],
  configId: string,
  input: { locale: BotMessageLocale; provider?: string } = { locale: "zh-CN" },
): string | undefined {
  return readConfigSelectLabelForValue(
    options,
    configId,
    readConfigSelectCurrentValue(options, configId),
    input,
  );
}

/** 发布包 host `resolveSupportedDraftMode`：别名能对上时仍返回调用方原始 modeId。 */
export function resolveSupportedDraftMode(
  options: ZCodeConfigOption[],
  modeId: string | undefined,
  provider: string,
): string | undefined {
  if (!modeId) return undefined;
  return resolveProviderModeIdFromConfigOptions({
    configOptions: options,
    modeId,
    provider,
  })
    ? modeId
    : undefined;
}

export function readCurrentActiveTaskModel(
  task: Pick<ZCodeTaskMeta, "model">,
  options: ZCodeConfigOption[],
): string | undefined {
  return readConfigSelectCurrentValue(options, "model") ?? task.model;
}

/** 发布包 host `readCurrentActiveTaskMode`。 */
export function readCurrentActiveTaskMode(
  task: Pick<ZCodeTaskMeta, "mode">,
  options: ZCodeConfigOption[],
): string | undefined {
  return readConfigSelectCurrentValue(options, "mode") ?? task.mode;
}

/** 发布包 host `listUserConfigOptions`：发布包实现固定返回空列表。 */
export async function listUserConfigOptions(_request?: {
  workspacePath?: string;
  workspaceIdentity?: string;
  provider?: string;
}): Promise<never[]> {
  return [];
}

/** 发布包 host `listProviderConfigOptionsForActiveTask`。 */
export async function listProviderConfigOptionsForActiveTask(
  context: { workspacePath: string; workspaceIdentity?: string },
  provider: string,
): Promise<never[]> {
  return listUserConfigOptions({
    workspacePath: context.workspacePath,
    workspaceIdentity: context.workspaceIdentity,
    provider,
  });
}

export { getConfigCommandMissingMessageId };

export async function readModelSelectionView(
  resolver: BotTaskServiceResolver,
  context: BotDraftWorkspace,
  selection?: ModelSelection,
): Promise<Awaited<ReturnType<IModelSelectionService["getView"]>> | null> {
  const service = await resolver.resolveModelSelectionServiceForContext(context).catch(() => null);
  if (!service) {
    return null;
  }
  return service.getView(selection ? { selection } : undefined).catch(() => null);
}

export function createModelSelectionProviderOption(provider: {
  providerId: string;
  providerName?: string | null;
  models: ReadonlyArray<{ modelId: string }>;
}): { id: string; label: string; models: BotSelectionOption[] } {
  return {
    id: provider.providerId,
    label: provider.providerName?.trim() || provider.providerId,
    models: provider.models.map((model) => ({
      id:
        provider.providerId === DEFAULT_DRAFT_PROVIDER
          ? model.modelId
          : `${provider.providerId}/${model.modelId}`,
      label: model.modelId,
    })),
  };
}

export async function listModelSelectionProviderOptions(
  resolver: BotTaskServiceResolver,
  context: BotDraftWorkspace,
): Promise<Array<{ id: string; label: string; models: BotSelectionOption[] }>> {
  const view = await readModelSelectionView(resolver, context);
  return view
    ? view.providers
        .map(createModelSelectionProviderOption)
        .filter((item) => item.models.length > 0)
    : [];
}

export async function listModelProviderOptionsForActiveTask(
  resolver: BotTaskServiceResolver,
  context: BotDraftWorkspace,
): Promise<Array<{ id: string; label: string; models: BotSelectionOption[] }>> {
  return listModelSelectionProviderOptions(resolver, context);
}

export async function listModelOptionsForProviderFromActiveTask(
  resolver: BotTaskServiceResolver,
  context: BotDraftWorkspace,
  providerId: string,
): Promise<BotSelectionOption[]> {
  return (
    (await listModelProviderOptionsForActiveTask(resolver, context)).find(
      (item) => item.id === providerId,
    )?.models ?? []
  );
}

export function readModelProviderSelectionModels(option: unknown): BotSelectionOption[] {
  if (!option || typeof option !== "object" || !("models" in option)) {
    return [];
  }
  const models = (option as { models?: unknown }).models;
  return Array.isArray(models)
    ? models.filter(
        (item): item is BotSelectionOption =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as BotSelectionOption).id === "string" &&
          typeof (item as BotSelectionOption).label === "string",
      )
    : [];
}

export async function listAllModelOptionsForActiveTask(
  resolver: BotTaskServiceResolver,
  context: BotDraftWorkspace,
): Promise<BotSelectionOption[]> {
  return (await listModelProviderOptionsForActiveTask(resolver, context)).flatMap(
    (item) => item.models,
  );
}

export async function formatStatusModelLabel(
  resolver: BotTaskServiceResolver,
  value: string | undefined,
  context: BotDraftWorkspace,
): Promise<string> {
  if (!value) {
    return "-";
  }
  const custom = parseBotModelOptionValue(value);
  const providers = await listModelSelectionProviderOptions(resolver, context);
  if (custom?.providerId) {
    const label = providers.find((item) => item.id === custom.providerId)?.label;
    return label && custom.modelId ? `${label}/${custom.modelId}` : (label ?? value);
  }
  return value;
}

export async function readCurrentModelProviderId(
  resolver: BotTaskServiceResolver,
  task: Pick<ZCodeTaskMeta, "model">,
  options: ZCodeConfigOption[],
  provider: string | undefined,
  context: BotDraftWorkspace,
): Promise<string | undefined> {
  const model = readCurrentActiveTaskModel(task, options);
  if (!model) {
    return undefined;
  }
  const custom = parseBotModelOptionValue(model);
  if (custom?.providerId && model.startsWith("custom:")) {
    return custom.providerId;
  }
  const providers = await listModelProviderOptionsForActiveTask(resolver, context);
  return (
    providers.find((item) => item.models.some((candidate) => candidate.id === model))?.id ??
    (provider ? getNativeModelProviderId(provider) : undefined)
  );
}

/** 发布包 host `buildInitializedDraftOptions`。 */
export async function buildInitializedDraftOptions(
  context: BotDraftWorkspace,
  isRemoteConnected: (context: BotDraftWorkspace) => Promise<boolean>,
  provider?: string,
): Promise<BotDraftOptions> {
  const next = toBotTaskProvider(provider ?? DEFAULT_DRAFT_PROVIDER);
  if (context.workspaceIdentity && !(await isRemoteConnected(context))) {
    return { provider: next };
  }
  return { provider: next, mode: BOT_FORCED_MODE };
}

export async function listActiveTaskConfigOptions(
  resolver: BotTaskServiceResolver,
  context: BotDraftWorkspace,
  taskId: string,
): Promise<ZCodeConfigOption[]> {
  return (await resolver.resolveZCodeTaskServiceForContext(context)).getTaskConfigOptions({
    taskId,
  });
}

export async function listDraftConfigOptions(
  resolver: BotTaskServiceResolver,
  context: BotDraftWorkspace,
  draft: BotDraftOptions,
  view?: Awaited<ReturnType<typeof readModelSelectionView>>,
): Promise<ZCodeConfigOption[]> {
  const modelView =
    view === undefined
      ? await readModelSelectionView(resolver, context, draft.modelSelection)
      : view;
  const selection = draft.modelSelection
    ? modelView?.effectiveSelection
    : modelView?.preferredSelection;
  if (!selection) {
    return [];
  }
  const spec = modelView?.providers
    .find((provider) => provider.providerId === selection.providerId)
    ?.models.find((model) => model.modelId === selection.modelId)?.config
    .optionSpecs.reasoningLevel;
  if (!spec) {
    return [];
  }
  return [
    {
      id: "thought_level",
      name: "Reasoning",
      category: "thought_level",
      type: "select",
      currentValue: selection.options?.reasoningLevel ?? "",
      options: spec.values.map((value) => ({ value, name: value })),
    },
  ];
}

export function completeBotModelSelection(
  view: NonNullable<Awaited<ReturnType<typeof readModelSelectionView>>>,
  selection: ModelSelection,
): ModelSelection | undefined {
  return completeNewModelSelection(view, selection);
}

export {
  formatBotModelSelectionValue,
  parseBotModelOptionValue,
  resolveCustomModelRuntimeModelId,
  toBotTaskProvider,
};
export type { BotTaskProvider };

export function copyMissing(locale: BotMessageLocale, configId: string): string {
  return copy(locale, getConfigCommandMissingMessageId(configId));
}

import type { BotActor, BotOutboundMessage, BotRuntimeState } from "@zcode/shared";
import {
  formatBotModelSelectionValue,
  formatStatusModelLabel,
  listActiveTaskConfigOptions,
  readConfigSelectCurrentValue,
  readModelSelectionView,
} from "./botsDraft.js";
import { formatStatusTaskLine, taskStatus } from "./botsHostHelpers.js";
import { ensureDraftOptions } from "./botsInboundDraft.js";
import {
  resolveZCodeTaskServiceForContext,
  type BotInboundTaskRuntime,
} from "./botsInboundRuntime.js";
import { copy, formatStatusLine, formatStatusStateValue } from "./botsInboundText.js";
import type { BotMessageLocale } from "./botsCopy.js";
import {
  formatTaskRunningDuration,
  readStatusProgressText,
  readTaskWorkedDurationMs,
} from "./botsStatusProgress.js";

/** 发布包 host `createStatusReply`。 */
export async function createStatusReply(
  runtime: BotInboundTaskRuntime,
  actor: BotActor,
  context: BotRuntimeState,
  locale: BotMessageLocale,
): Promise<BotOutboundMessage[]> {
  return runtime.replies(actor, await buildStatusText(runtime, context, locale), locale);
}

/** 发布包 host `buildStatusText`。进展读 liveStatusProgress，耗时从 snapshot 计算。 */
export async function buildStatusText(
  runtime: BotInboundTaskRuntime,
  context: BotRuntimeState,
  locale: BotMessageLocale,
): Promise<string> {
  const workspace = (await runtime.listWorkspaceRefs()).find(
    (item) => item.id === context.workspaceId,
  );
  const workspaceLabel = workspace?.label ?? context.workspacePath;
  if (!(await runtime.isRemoteConnected(context))) {
    const draft = context.draftOptions;
    return [
      formatStatusLine(locale, "statusWorkspace", workspaceLabel),
      formatStatusLine(
        locale,
        "statusModel",
        await formatStatusModelSafe(
          runtime,
          formatBotModelSelectionValue(draft?.modelSelection),
          context,
        ),
      ),
      "------",
      formatStatusLine(locale, "statusTask", context.activeTaskId ?? copy(locale, "statusDraft")),
      formatStatusLine(
        locale,
        "statusState",
        formatStatusStateValue(locale, "remote disconnected"),
      ),
      copy(locale, "remoteDisconnectedStatus", { workspacePath: context.workspacePath }),
    ].join("\n");
  }
  // 发布包 status 会 listTasks；测试 Host 未注入 task service 时不能按 unique 直接调用。
  const taskService = await resolveZCodeTaskServiceForContext(runtime, context).catch(() => null);
  if (!taskService) {
    return [
      formatStatusLine(locale, "statusWorkspace", workspaceLabel),
      formatStatusLine(locale, "statusModel", "-"),
      "------",
      formatStatusLine(locale, "statusTask", copy(locale, "statusDraft")),
      formatStatusLine(locale, "statusState", formatStatusStateValue(locale, "draft")),
    ].join("\n");
  }
  const listed = await taskService
    .listTasks({
      workspacePath: context.workspacePath,
      workspaceIdentity: context.workspaceIdentity,
    })
    .catch(() => []);
  const snapshot = context.activeTaskId
    ? await taskService
        .getTaskSnapshot({
          taskId: context.activeTaskId,
          workspacePath: context.workspacePath,
          workspaceIdentity: context.workspaceIdentity,
        })
        .catch(() => null)
    : null;
  const meta =
    (context.activeTaskId ? listed.find((item) => item.taskId === context.activeTaskId) : null) ??
    snapshot?.meta ??
    null;
  const draft =
    !meta && (context.mode === "draft" || !context.activeTaskId)
      ? await ensureDraftOptions(runtime, context)
      : null;
  const view = draft ? await readModelSelectionView(runtime, context, draft.modelSelection) : null;
  const selection = draft?.modelSelection ? view?.effectiveSelection : view?.preferredSelection;
  const options = context.activeTaskId
    ? await listActiveTaskConfigOptions(runtime, context, context.activeTaskId).catch(() => [])
    : [];
  const modelValue =
    readConfigSelectCurrentValue(options, "model") ??
    meta?.model ??
    formatBotModelSelectionValue(selection ?? undefined) ??
    "-";
  const progress = readStatusProgressText(
    runtime.liveStatusProgress,
    context.activeTaskId,
    meta,
    snapshot,
  );
  const worked = meta ? readTaskWorkedDurationMs(snapshot, meta) : null;
  return [
    formatStatusLine(locale, "statusWorkspace", workspaceLabel),
    formatStatusLine(
      locale,
      "statusModel",
      await formatStatusModelSafe(runtime, modelValue, context),
    ),
    "------",
    meta
      ? formatStatusTaskLine(meta, copy(locale, "statusTask"))
      : formatStatusLine(locale, "statusTask", copy(locale, "statusDraft")),
    formatStatusLine(
      locale,
      "statusState",
      formatStatusStateValue(locale, meta ? taskStatus(meta) : "draft"),
    ),
    worked !== null
      ? formatStatusLine(locale, "statusWorked", formatTaskRunningDuration(worked))
      : null,
    progress ? formatStatusLine(locale, "statusProgress", progress) : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

async function formatStatusModelSafe(
  runtime: BotInboundTaskRuntime,
  value: string | undefined,
  context: BotRuntimeState,
): Promise<string> {
  return formatStatusModelLabel(runtime, value, context).catch(() => value ?? "-");
}

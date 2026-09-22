import type {
  BotInboundMessage,
  BotOutboundMessage,
  BotRuntimeState,
  BotsConfig,
  BotWorkspaceRef,
  ZCodeConfigOption,
  ZCodeTaskMeta,
} from "@zcode/shared";
import { copy } from "./botsInboundText.js";
import { readContextActiveTaskMeta, writeDraftContext, buildActiveTaskDraftOptions, createStatusReply } from "./botsInboundDraft.js";
import {
  resolveZCodeTaskServiceForContext,
  type BotInboundTaskRuntime,
} from "./botsInboundRuntime.js";
import { normalizeConfiguredAllowedWorkspaces } from "./botsNormalize.js";
import { isContextActiveTaskRunning } from "./botsTaskStream.js";
import { buildInitializedDraftOptions } from "./botsDraft.js";

export async function requireActiveTask(
  runtime: BotInboundTaskRuntime,
  message: BotInboundMessage,
  authorized: { context: BotRuntimeState; locale: "zh-CN" | "en-US" },
): Promise<
  | { ok: false; reply: BotOutboundMessage[] }
  | { ok: true; taskId: string; task: ZCodeTaskMeta; configOptions: ZCodeConfigOption[] }
> {
  if (!authorized.context.activeTaskId) {
    return { ok: false, reply: runtime.replies(message.actor, copy(authorized.locale, "noActiveTask")) };
  }
  const task = await readContextActiveTaskMeta(runtime, authorized.context);
  if (!task) {
    return { ok: false, reply: runtime.replies(message.actor, copy(authorized.locale, "noActiveTask")) };
  }
  const configOptions = await (
    await resolveZCodeTaskServiceForContext(runtime, authorized.context)
  ).getTaskConfigOptions({
    taskId: authorized.context.activeTaskId,
  });
  return { ok: true, taskId: authorized.context.activeTaskId, task, configOptions };
}

export async function normalizeBotWorkspaceConfig(
  runtime: BotInboundTaskRuntime,
  config: BotsConfig,
  bot: Parameters<BotInboundTaskRuntime["saveBot"]>[0],
  current: BotWorkspaceRef,
) {
  const workspaces = await runtime.listWorkspaceRefs(current);
  const allowed = normalizeConfiguredAllowedWorkspaces(bot.allowedWorkspaces, workspaces);
  const nextBot = { ...bot, allowedWorkspaces: allowed };
  const nextConfig = { ...config, bots: config.bots.map((item) => (item.id === bot.id ? nextBot : item)) };
  if (nextBot.allowedWorkspaces.join("\n") !== bot.allowedWorkspaces.join("\n")) {
    await runtime.repo.writeConfig(nextConfig);
  }
  return { config: nextConfig, bot: nextBot, user: nextBot, workspaces };
}

export async function buildInitializedDraft(
  runtime: BotInboundTaskRuntime,
  workspace: { workspacePath: string; workspaceIdentity?: string },
) {
  return buildInitializedDraftOptions(workspace, (item) => runtime.isRemoteConnected(item));
}

/** 发布包 host `/new`：清到草稿后回 status。 */
export async function handleNewCommand(
  runtime: BotInboundTaskRuntime,
  message: BotInboundMessage,
): Promise<BotOutboundMessage[]> {
  const authorized = await runtime.withAuthorizedContext(message, "new");
  if (!authorized.ok) {
    return authorized.reply;
  }
  if (await isContextActiveTaskRunning(runtime, authorized.context)) {
    return runtime.replies(message.actor, copy(authorized.locale, "taskRunning"));
  }
  const next = await writeDraftContext(
    runtime,
    authorized.context,
    await buildActiveTaskDraftOptions(runtime, authorized.context),
  );
  return createStatusReply(runtime, message.actor, next, authorized.locale);
}

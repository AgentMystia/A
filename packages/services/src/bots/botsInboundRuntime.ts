import type {
  BotActor,
  BotConfigEntry,
  BotInboundMessage,
  BotOutboundMessage,
  BotProviderOutbound,
  BotRuntimeState,
  BotWorkspaceRef,
  ZCodeConfigOption,
  ZCodeTaskMeta,
} from "@zcode/shared";
import type { IBroadcastService } from "../broadcast/broadcast.js";
import type { ServiceLogger } from "../logger/serviceLogger.js";
import type { IModelSelectionService } from "../model-provider/providerFacadeServices.js";
import type { IZCodeTaskService } from "../session/zcodeTaskService.js";
import type { BotMessageLocale } from "./botsCopy.js";
import type { AuthorizedContext } from "./botsInbound.js";
import type { IBotRemoteWorkspaceService } from "./botsRemoteWorkspace.js";
import type { BotsRepo } from "./botsRepo.js";
import type { TransientInteractionCardEntry } from "./botsTransientCards.js";
import type { BotSelection, BotSelectionOption, BotProvider } from "./botsTypes.js";
import type { BotTaskServiceResolver } from "./botsDraft.js";
import { createWorkspaceRef, getWorkspaceKey } from "./botsNormalize.js";

export interface BotContextTaskEntry {
  task: ZCodeTaskMeta;
  workspacePath: string;
  workspaceIdentity?: string;
}

export interface BotInboundTaskRuntime extends BotTaskServiceResolver {
  repo: BotsRepo;
  remoteWorkspaceService?: IBotRemoteWorkspaceService;
  broadcastService?: Pick<IBroadcastService, "send">;
  zcodeTaskService?: IZCodeTaskService;
  modelSelectionService?: IModelSelectionService;
  logger: Pick<ServiceLogger, "info" | "warn" | "debug">;
  runningTasks: Set<string>;
  streamSubs: Map<string, { dispose(): void }>;
  pendingSelections: Map<string, BotSelection>;
  taskSelectionEntries: Map<string, Map<string, BotContextTaskEntry>>;
  workspaceSelectionEntries: Map<string, Map<string, { workspace: BotWorkspaceRef }>>;
  automationWarnAt: Map<string, number>;
  persistContext(context: BotRuntimeState): Promise<BotRuntimeState>;
  replies(
    actor: BotActor,
    text: string,
    locale?: BotMessageLocale,
    selection?: BotSelection,
    extra?: Partial<BotProviderOutbound>,
  ): BotOutboundMessage[];
  withAuthorizedContext(message: BotInboundMessage, command: string): Promise<AuthorizedContext>;
  readMessageLocale(): Promise<BotMessageLocale>;
  listWorkspaceRefs(current?: BotWorkspaceRef): Promise<BotWorkspaceRef[]>;
  isRemoteConnected(
    context: Pick<BotRuntimeState, "workspacePath" | "workspaceIdentity">,
  ): Promise<boolean>;
  saveBot(bot: BotConfigEntry): Promise<BotConfigEntry>;
  sendOutbound(bot: BotConfigEntry, outbound: BotProviderOutbound): Promise<void>;
  sendAckTyping(bot: BotConfigEntry, actor: BotActor): Promise<void>;
  startTyping(bot: BotConfigEntry, actor: BotActor, taskId: string): void;
  stopTyping(taskId: string): void;
  stopInboundTyping(bot: BotConfigEntry, actor: BotActor): Promise<void>;
  providers: Record<string, BotProvider | null>;
  transientCards: Map<string, TransientInteractionCardEntry>;
}

export async function resolveZCodeTaskServiceForContext(
  runtime: Pick<BotInboundTaskRuntime, "zcodeTaskService" | "remoteWorkspaceService">,
  context: { workspacePath: string; workspaceIdentity?: string },
): Promise<IZCodeTaskService> {
  if (!context.workspaceIdentity) {
    if (!runtime.zcodeTaskService) {
      throw new Error(
        `当前远端项目 ${context.workspacePath} runtime 不可用，请发送 **/\u91cd\u8fde** 后重试。`,
      );
    }
    return runtime.zcodeTaskService;
  }
  const remote = await runtime.remoteWorkspaceService?.getZCodeTaskService({
    workspacePath: context.workspacePath,
    workspaceIdentity: context.workspaceIdentity,
  });
  if (remote) {
    return remote;
  }
  throw new Error(
    `当前远端项目 ${context.workspacePath} runtime 不可用，请发送 **/\u91cd\u8fde** 后重试。`,
  );
}

export async function resolveModelSelectionServiceForContext(
  runtime: Pick<BotInboundTaskRuntime, "modelSelectionService" | "remoteWorkspaceService">,
  context: { workspacePath: string; workspaceIdentity?: string },
): Promise<IModelSelectionService | null> {
  if (!context.workspaceIdentity) {
    return runtime.modelSelectionService ?? null;
  }
  const remote = await runtime.remoteWorkspaceService?.getModelSelectionService({
    workspacePath: context.workspacePath,
    workspaceIdentity: context.workspaceIdentity,
  });
  if (remote) {
    return remote;
  }
  throw new Error(
    `当前远端项目 ${context.workspacePath} runtime 不可用，请发送 **/\u91cd\u8fde** 后重试。`,
  );
}

export function createTaskServiceResolver(runtime: BotInboundTaskRuntime): BotTaskServiceResolver {
  return {
    resolveZCodeTaskServiceForContext: (context) =>
      resolveZCodeTaskServiceForContext(runtime, context),
    resolveModelSelectionServiceForContext: (context) =>
      resolveModelSelectionServiceForContext(runtime, context),
  };
}

/** 发布包 host `requiresRemoteWorkspaceRuntime`。 */
export function requiresRemoteWorkspaceRuntime(command: string): boolean {
  return (
    command !== "help" &&
    command !== "status" &&
    command !== "workspace" &&
    command !== "reconnect" &&
    command !== "reply"
  );
}

export async function blockDisconnectedRemoteWorkspace(
  runtime: BotInboundTaskRuntime,
  input: {
    message: BotInboundMessage;
    context: BotRuntimeState;
    locale: BotMessageLocale;
    requestedCommand: string;
    disconnectedText: string;
  },
): Promise<BotOutboundMessage[] | null> {
  if (
    !input.context.workspaceIdentity ||
    !requiresRemoteWorkspaceRuntime(input.requestedCommand) ||
    (await runtime.isRemoteConnected(input.context))
  ) {
    return null;
  }
  return runtime.replies(input.message.actor, input.disconnectedText);
}

export function readConfigSelectCurrentLabel(
  options: ZCodeConfigOption[],
  configId: string,
  listed: BotSelectionOption[],
): string | undefined {
  const current = listed.find(
    (item) =>
      item.id === String(options.find((option) => option.id === configId)?.currentValue ?? ""),
  );
  return current?.label;
}

export function botTaskStreamKey(context: {
  workspacePath: string;
  workspaceIdentity?: string;
  activeTaskId: string;
}): string {
  return `${getWorkspaceKey(context.workspacePath, context.workspaceIdentity)}::${context.activeTaskId}`;
}

export function createCurrentWorkspaceRef(context: BotRuntimeState): BotWorkspaceRef {
  return createWorkspaceRef(context.workspacePath, context.workspaceIdentity);
}

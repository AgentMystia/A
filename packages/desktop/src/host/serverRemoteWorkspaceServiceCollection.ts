import {
  ServiceCollection,
  IFileService,
  IMediaPreviewService,
  IGitService,
  IGitCheckpointService,
  ISystemService,
  ITerminalService,
  ISettingService,
  ICredentialService,
  IBroadcastService,
  IZCodeTaskService,
  IZCodeAgentService,
  IZCodeSessionService,
  IConversationShareService,
  IBotsService,
  IFileWatcherService,
  IOAuthService,
  IModelSelectionService,
  IProviderSettingsService,
  IUsageStatsService,
  ICodingPlanSubscriptionService,
  IClientConfigService,
  IClientScenesService,
  ISkillsService,
  ISkillSyncService,
  IMcpSyncService,
  IPluginsService,
  IPluginManagementService,
  ISubagentsService,
  ICommandsService,
  IHooksService,
  IMemoryService,
  IOutputStyleService,
  ISettingsSyncService,
  IPromptAttachmentTransferService,
  createUnsupportedConversationShareService,
  type IServiceAccessor,
} from "@zcode/services";
import { createMediaPreviewService, createServiceLogger } from "@zcode/services/node";
import { assertLegacyRemoteWorkspaceRpcContract } from "./legacyRemoteWorkspaceRpcContract.js";
import {
  createRemoteProviderProvisioningExecutorFromWorkspace,
  registerRemoteProviderProvisioningExecutor,
} from "./remoteProviderProvisioningService.js";

const conversationShareLogger = createServiceLogger("conversation-share");

function createUnsupportedRemoteConversationShareService(): IConversationShareService {
  return createUnsupportedConversationShareService({
    message: "Conversation sharing is not available for this client or remote target",
    onRejected: (action) =>
      conversationShareLogger.warn(undefined, "conversation share action rejected", {
        action,
        kind: "feature_disabled",
        reason: "server_remote_unsupported",
      }),
  });
}

/**
 * server 远端服务全部来自 websocket RPC。
 * 不在本机再造 settings、oauth 或会话分享；client config 仍用窗口 Host 注入的那一份。
 */
export function createServerRemoteWorkspaceServiceCollection(params: {
  clientConfigService: IClientConfigService;
  connectionServices: IServiceAccessor;
  sourceServices?: ServiceCollection;
}): ServiceCollection {
  assertLegacyRemoteWorkspaceRpcContract(params.connectionServices);
  const provisioning = createRemoteProviderProvisioningExecutorFromWorkspace(params);
  const services = new ServiceCollection()
    .register(IFileService, params.connectionServices.fileService)
    .register(
      IMediaPreviewService,
      params.connectionServices.mediaPreviewService ??
        createMediaPreviewService({ fileService: params.connectionServices.fileService }),
    )
    .register(IGitService, params.connectionServices.gitService)
    .register(IGitCheckpointService, params.connectionServices.gitCheckpointService)
    .register(ISystemService, params.connectionServices.systemService)
    .register(ITerminalService, params.connectionServices.terminalService)
    .register(ISettingService, params.connectionServices.settingService)
    .register(ICredentialService, params.connectionServices.credentialService)
    .register(IBroadcastService, params.connectionServices.broadcastService)
    .register(IZCodeTaskService, params.connectionServices.zcodeTaskService)
    .register(IZCodeAgentService, params.connectionServices.zcodeAgentService)
    .register(IZCodeSessionService, params.connectionServices.zcodeSessionService)
    .register(IConversationShareService, createUnsupportedRemoteConversationShareService())
    .register(IBotsService, params.connectionServices.botsService)
    .register(IFileWatcherService, params.connectionServices.fileWatcherService)
    .register(IOAuthService, params.connectionServices.oauthService)
    .register(IModelSelectionService, params.connectionServices.modelSelectionService)
    .register(IProviderSettingsService, params.connectionServices.providerSettingsService)
    .register(IUsageStatsService, params.connectionServices.usageStatsService)
    .register(
      ICodingPlanSubscriptionService,
      params.connectionServices.codingPlanSubscriptionService,
    )
    .register(IClientConfigService, params.clientConfigService)
    .register(IClientScenesService, params.connectionServices.clientScenesService)
    .register(ISkillsService, params.connectionServices.skillsService)
    .register(ISkillSyncService, params.connectionServices.skillSyncService)
    .register(IMcpSyncService, params.connectionServices.mcpSyncService)
    .register(IPluginsService, params.connectionServices.pluginsService)
    .register(IPluginManagementService, params.connectionServices.pluginManagementService)
    .register(ISubagentsService, params.connectionServices.subagentsService)
    .register(ICommandsService, params.connectionServices.commandsService)
    .register(IHooksService, params.connectionServices.hooksService)
    .register(IMemoryService, params.connectionServices.memoryService)
    .register(IOutputStyleService, params.connectionServices.outputStyleService)
    .register(ISettingsSyncService, params.connectionServices.settingsSyncService)
    .register(
      IPromptAttachmentTransferService,
      params.connectionServices.promptAttachmentTransferService,
    );
  registerRemoteProviderProvisioningExecutor(services, provisioning);
  return services;
}

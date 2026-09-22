import {
  ServiceChannels,
  type BotAutomationRunWatch,
  type BotBindCodeResult,
  type BotConfigEntry,
  type BotCurrentOptions,
  type BotInboundMessage,
  type BotOutboundMessage,
  type BotProviderCallbackResult,
  type BotProviderId,
  type BotRuntimeState,
  type BotTestResult,
  type BotWorkspaceRef,
  type BotsConfig,
  type BotsServiceStatus,
  type FeishuRegistrationBegin,
  type FeishuRegistrationPoll,
  type SaveBotRequest,
  type WeixinRegistrationBegin,
  type WeixinRegistrationPoll,
} from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IBotsService {
  syncAppRuntimePreferences(preferences: unknown): Promise<void>;
  getStatus(): Promise<BotsServiceStatus>;
  getConfig(): Promise<BotsConfig>;
  listWorkspaceRefs(): Promise<BotWorkspaceRef[]>;
  getUserConfigOptions(request?: { workspacePath?: string }): Promise<BotCurrentOptions[]>;
  beginFeishuRegistration(request?: { domain?: "feishu" | "lark" }): Promise<FeishuRegistrationBegin>;
  pollFeishuRegistration(request: {
    deviceCode: string;
    domain?: "feishu" | "lark";
    pollDomain?: "feishu" | "lark";
  }): Promise<FeishuRegistrationPoll>;
  beginWeixinRegistration(): Promise<WeixinRegistrationBegin>;
  pollWeixinRegistration(request: { qrCode: string }): Promise<WeixinRegistrationPoll>;
  saveConfig(config: BotsConfig): Promise<BotsConfig>;
  listBots(): Promise<BotConfigEntry[]>;
  saveBot(request: SaveBotRequest): Promise<BotConfigEntry>;
  removeBotSecret(botId: string): Promise<BotConfigEntry>;
  deleteBot(botId: string): Promise<void>;
  testBot(botId: string): Promise<BotTestResult & { provider?: BotProviderId }>;
  createBindCode(request: {
    botId: string;
    ttlMs?: number;
    allowedWorkspaces?: string[];
  }): Promise<BotBindCodeResult>;
  getBotStates(): Promise<BotRuntimeState[]>;
  resetBotState(botId: string): Promise<void>;
  watchAutomationRun(watch: BotAutomationRunWatch): Promise<void>;
  handleInboundMessage(message: BotInboundMessage): Promise<BotOutboundMessage[]>;
  handleProviderCallback(provider: BotProviderId, payload: unknown): Promise<BotOutboundMessage[]>;
  handleProviderCallbackResponse(
    provider: BotProviderId,
    payload: unknown,
  ): Promise<BotProviderCallbackResult>;
  disposeAll(): void;
  disposeAllAndWait(): Promise<void>;
}

export const IBotsService = createServiceDescriptor<IBotsService>(ServiceChannels.Bots);

import type {
  BotActor,
  BotConfigEntry,
  BotInboundMessage,
  BotProviderId,
  BotProviderOutbound,
  BotRuntimeStatus,
} from "@zcode/shared";

export interface BotCredentialLoader {
  loadCredential(ref: string): Promise<string | null>;
}

export interface BotProvider {
  test(bot: BotConfigEntry): Promise<{ ok: boolean; message: string; name?: string }>;
  resolveName?(bot: BotConfigEntry): Promise<string | null>;
  resolveActorDisplayName?(bot: BotConfigEntry, actor: BotActor): Promise<string | null>;
  syncCommands?(bot: BotConfigEntry): Promise<void>;
  send(bot: BotConfigEntry, message: BotProviderOutbound): Promise<void>;
  sendTyping?(
    bot: BotConfigEntry,
    actor: Pick<BotActor, "providerUserId" | "providerContextToken" | "providerMessageId">,
  ): Promise<void>;
  startTyping?(bot: BotConfigEntry, actor: Pick<BotActor, "providerMessageId">): Promise<void>;
  stopTyping?(bot: BotConfigEntry, actor: Pick<BotActor, "providerMessageId">): Promise<void>;
  acknowledgeCallback?(
    bot: BotConfigEntry,
    payload: unknown,
    toast?: string,
    outbound?: BotProviderOutbound,
    signal?: AbortSignal,
  ): Promise<unknown>;
  downloadAttachment?(
    bot: BotConfigEntry,
    attachment: {
      providerFileId?: string;
      kind?: string;
      downloadUrl?: string;
      providerMetadata?: { weixinAesKey?: string };
    },
    context?: { providerMessageId?: string },
  ): Promise<{ attachment: unknown; data: Uint8Array } | null>;
  parseCallback(payload: unknown): BotInboundMessage[];
  createStreamingReplyCard?(
    bot: BotConfigEntry,
    message: BotStreamingReplyCardState,
    signal?: AbortSignal,
  ): Promise<{ providerMessageId: string } | null>;
  updateStreamingReplyCard?(
    bot: BotConfigEntry,
    handle: { providerMessageId: string },
    message: BotStreamingReplyCardState,
    signal?: AbortSignal,
  ): Promise<void>;
  splitStreamingReplyCardStates?(state: BotStreamingReplyCardState): BotStreamingReplyCardState[];
  createTransientInteractionCard?(
    bot: BotConfigEntry,
    message: BotProviderOutbound,
  ): Promise<{ providerMessageId: string } | null>;
  updateTransientInteractionCard?(
    bot: BotConfigEntry,
    handle: { providerMessageId: string },
    message: BotProviderOutbound,
  ): Promise<void>;
  deleteTransientInteractionCard?(
    bot: BotConfigEntry,
    handle: { providerMessageId: string },
  ): Promise<void>;
}

export interface BotRuntimeStatusSink {
  getRuntimeStatus(botId: string): BotRuntimeStatus | undefined;
  setRuntimeStatus(
    status: Partial<BotRuntimeStatus> & { botId: string; provider: BotProviderId },
  ): void;
}

/** 发布包 host 传给 create/updateStreamingReplyCard 的卡片状态。 */
export interface BotStreamingReplyCardState {
  providerUserId: string;
  locale?: "zh-CN" | "en-US";
  status: "running" | "completed" | "error" | "sealed";
  blocks: Array<
    | { type: "message"; text: string }
    | { type: "tools"; title?: string; summaries: string[]; expanded?: boolean }
  >;
}

export interface BotSelectionOption {
  id: string;
  label: string;
  description?: string;
}

export interface BotSelection {
  id: string;
  title: string;
  currentId?: string;
  action: string;
  options: BotSelectionOption[];
  showCancel?: boolean;
  cancelLabel?: string;
  token?: string;
}

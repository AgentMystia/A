import type { BotConfigEntry, BotProviderId, BotRuntimeStatus } from "@zcode/shared";
import { createFeishuBotProvider } from "./botsFeishu.js";
import { createTelegramBotProvider } from "./botsTelegram.js";
import type { BotProvider, BotRuntimeStatusSink } from "./botsTypes.js";
import { createWebhookBotProvider } from "./botsWebhook.js";
import { createWeixinBotProvider } from "./botsWeixin.js";

/** 发布包 host 的 provider 表。飞书/Lark 共用 createFeishuBotProvider。 */
export function createBotProviderMap(input: {
  loadCredential: (ref: string) => Promise<string | null>;
  runtimeStatus: Map<string, BotRuntimeStatus>;
  setRuntimeStatus: BotRuntimeStatusSink["setRuntimeStatus"];
}): Record<BotProviderId, BotProvider | null> {
  const reportDelivery = (bot: BotConfigEntry, error?: string) => {
    input.setRuntimeStatus({
      botId: bot.id,
      provider: bot.provider,
      status: input.runtimeStatus.get(bot.id)?.status ?? (bot.enabled ? "idle" : "disabled"),
      deliveryError: error,
    });
  };
  return {
    telegram: createTelegramBotProvider({ loadCredential: input.loadCredential }),
    webhook: createWebhookBotProvider({ loadCredential: input.loadCredential }),
    feishu: createFeishuBotProvider({
      loadCredential: input.loadCredential,
      onDeliveryResult: reportDelivery,
    }),
    lark: createFeishuBotProvider({
      loadCredential: input.loadCredential,
      onDeliveryResult: reportDelivery,
    }),
    weixin: createWeixinBotProvider({ loadCredential: input.loadCredential }),
    discord: null,
    wecom: null,
  };
}

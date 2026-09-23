import type { BotsConfig } from "./bots.js";

/** 发布包 host index：`{ version: 3, bots: [] }`。 */
export function createDefaultBotsConfig(): BotsConfig {
  return { version: 3, bots: [] };
}

/** 发布包 host index：`bot:${botId}:credential`。 */
export function buildBotCredentialKey(botId: string): string {
  return `bot:${botId}:credential`;
}

/** 发布包 host index：`bot:${botId}:webhook-secret`。 */
export function buildBotWebhookSecretKey(botId: string): string {
  return `bot:${botId}:webhook-secret`;
}

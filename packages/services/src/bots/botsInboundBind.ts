import {
  type BotConfigEntry,
  type BotInboundMessage,
  type BotOutboundMessage,
  normalizeBotReplyGranularity,
} from "@zcode/shared";
import { copy, buildHelpText } from "./botsInboundText.js";
import type { BotMessageLocale } from "./botsCopy.js";
import { findBot, normalizeAllowedWorkspaces, normalizeBotCommandPolicy } from "./botsNormalize.js";
import type { BotsRepo } from "./botsRepo.js";

export async function handleBindCommand(input: {
  message: BotInboundMessage;
  code: string;
  locale: BotMessageLocale;
  repo: BotsRepo;
  bindCodes: Map<string, { botId: string; code: string; allowedWorkspaces: string[]; expiresAt: number }>;
  replies(actor: BotInboundMessage["actor"], text: string): BotOutboundMessage[];
}): Promise<BotOutboundMessage[]> {
  if (input.message.actor.chatType !== "private") {
    return input.replies(input.message.actor, copy(input.locale, "bindPrivateOnly"));
  }
  const record = input.bindCodes.get(input.code.trim().toUpperCase());
  if (!record || record.expiresAt <= Date.now() || record.botId !== input.message.botId) {
    return input.replies(input.message.actor, copy(input.locale, "bindCodeInvalid"));
  }
  const config = await input.repo.readConfig();
  const bot = findBot(config, record.botId);
  if (!bot) {
    return input.replies(input.message.actor, copy(input.locale, "bindBotMissing"));
  }
  const next: BotConfigEntry = {
    ...bot,
    providerUserId: input.message.actor.providerUserId,
    displayName: input.message.actor.displayName,
    allowedWorkspaces: normalizeAllowedWorkspaces(record.allowedWorkspaces),
    allowedCommands: normalizeBotCommandPolicy(bot.allowedCommands),
    replyMode: normalizeBotReplyGranularity(bot.provider, bot.replyMode),
  };
  await input.repo.writeConfig({
    ...config,
    bots: config.bots.map((item) => (item.id === next.id ? next : item)),
  });
  input.bindCodes.delete(record.code);
  return input.replies(input.message.actor, [copy(input.locale, "bindSuccess"), buildHelpText(input.locale, next)].join("\n\n"));
}

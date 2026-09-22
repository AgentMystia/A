import {
  getSupportedBotReplyGranularities,
  normalizeBotReplyGranularity,
  type BotProviderId,
  type BotReplyMode,
} from "@zcode/shared";
import type { BotMessageLocale } from "./botsCopy.js";
import { copy } from "./botsInboundText.js";
import type { BotSelection } from "./botsTypes.js";

export function listReplyGranularityOptions(
  locale: BotMessageLocale,
  provider: BotProviderId,
): BotSelection["options"] {
  return getSupportedBotReplyGranularities(provider).map((id) => ({
    id,
    label: copy(locale, "replySelectTitle", { mode: id }).split("\n")[0] ?? id,
  }));
}

export function formatReplyGranularityLabel(
  locale: BotMessageLocale,
  provider: BotProviderId,
  replyMode?: BotReplyMode,
): string {
  const id = normalizeBotReplyGranularity(provider, replyMode);
  return listReplyGranularityOptions(locale, provider).find((option) => option.id === id)?.label ?? id;
}

export function parseReplyGranularity(
  value: string,
  locale: BotMessageLocale,
  provider: BotProviderId,
): BotReplyMode | null {
  const options = listReplyGranularityOptions(locale, provider);
  const trimmed = value.trim();
  const index = Number.parseInt(trimmed, 10);
  if (Number.isFinite(index) && index >= 1 && index <= options.length) {
    return options[index - 1]!.id as BotReplyMode;
  }
  return options.find((option) => option.id === trimmed)?.id as BotReplyMode | undefined ?? null;
}

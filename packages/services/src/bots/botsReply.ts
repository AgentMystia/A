import {
  getSupportedBotReplyGranularities,
  normalizeBotReplyGranularity,
  type BotProviderId,
  type BotReplyMode,
} from "@zcode/shared";
import type { BotMessageLocale } from "./botsCopy.js";
import { copy } from "./botsInboundText.js";
import type { BotSelection } from "./botsTypes.js";

/** 发布包 host `AH`：回复粒度选项与别名。 */
const REPLY_GRANULARITY_DEFS: Array<{
  id: BotReplyMode;
  label: Record<BotMessageLocale, string>;
  aliases: string[];
}> = [
  {
    id: "assistant_changes",
    label: { "zh-CN": "标准回复", "en-US": "Standard reply" },
    aliases: ["assistant", "assistant_changes", "normal", "default", "standard", "标准回复"],
  },
  {
    id: "assistant_toolcalls_changes",
    label: { "zh-CN": "完整回复", "en-US": "Full reply" },
    aliases: ["full", "tool", "toolcalls", "assistant_toolcalls_changes", "完整回复"],
  },
  {
    id: "summary_changes",
    label: { "zh-CN": "摘要回复", "en-US": "Summary reply" },
    aliases: ["summary", "summary_changes", "latest", "摘要回复"],
  },
  {
    id: "streaming_card",
    label: { "zh-CN": "流式卡片", "en-US": "Streaming card" },
    aliases: ["stream", "streaming", "streaming_card", "流式", "流式卡片"],
  },
];

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

/** 发布包 host `getReplyGranularityOptions`。 */
export function getReplyGranularityOptions(
  locale: BotMessageLocale,
  provider: BotProviderId,
): BotSelection["options"] {
  const allowed = new Set(getSupportedBotReplyGranularities(provider));
  const lang = locale === "en-US" ? "en-US" : "zh-CN";
  return REPLY_GRANULARITY_DEFS.filter((item) => allowed.has(item.id)).map((item) => ({
    id: item.id,
    label: item.label[lang],
  }));
}

/** 发布包 host `formatReplyGranularityLabel`。 */
export function formatReplyGranularityLabel(
  locale: BotMessageLocale,
  provider: BotProviderId,
  replyMode?: BotReplyMode,
): string {
  const id = normalizeBotReplyGranularity(provider, replyMode);
  return (
    getReplyGranularityOptions(locale, provider).find((option) => option.id === id)?.label ?? id
  );
}

/** 发布包 host `resolveReplyGranularityByValue`。 */
export function parseReplyGranularity(
  value: string,
  locale: BotMessageLocale,
  provider: BotProviderId,
): BotReplyMode | null {
  const option = resolveReplyGranularityByValue(value, locale, provider);
  return option ? (option.id as BotReplyMode) : null;
}

/** 发布包 host `resolveReplyGranularityByValue`。 */
export function resolveReplyGranularityByValue(
  value: string,
  locale: BotMessageLocale,
  provider: BotProviderId,
): BotSelection["options"][number] | null {
  const trimmed = value.trim();
  const options = getReplyGranularityOptions(locale, provider);
  const index = Number.parseInt(trimmed, 10);
  if (Number.isFinite(index) && index > 0) {
    return options[index - 1] ?? null;
  }
  const token = normalizeText(trimmed);
  const def = REPLY_GRANULARITY_DEFS.find(
    (item) =>
      item.aliases.includes(token) ||
      normalizeText(item.label["zh-CN"]) === token ||
      normalizeText(item.label["en-US"]) === token,
  );
  return def ? (options.find((option) => option.id === def.id) ?? null) : null;
}

export function currentOptionSuffix(locale: BotMessageLocale): string {
  return locale === "en-US" ? "current" : "当前";
}

export { copy };

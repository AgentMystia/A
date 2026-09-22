import {
  buildZCodeAssistantPresentation,
  DEFAULT_BOT_REPLY_MODE,
  normalizeBotReplyGranularity,
  type BotProviderId,
  type BotReplyMode,
  type ZCodeAssistantMessagePart,
  type ZCodeStreamEvent,
  type ZCodeTaskChangeSummary,
} from "@zcode/shared";
import {
  formatBotChangeSummary,
  formatBotToolCallReply,
  splitLongReplyText,
  type BotReplyFormatContext,
  type BotReplyToolCall,
} from "./botsReplyFormat.js";

export type BotAssistantReplyBlock =
  | { type: "content"; content: string }
  | { type: "tool-call"; toolCall: BotReplyToolCall }
  | { type: "change-summary"; changeSummary: ZCodeTaskChangeSummary };

/** 发布包 host `getDefaultBotReplyGranularity`。无 provider 时用 assistant_changes。 */
export function getDefaultBotReplyGranularity(provider?: BotProviderId): BotReplyMode {
  return provider ? normalizeBotReplyGranularity(provider, undefined) : DEFAULT_BOT_REPLY_MODE;
}

/** 发布包 host `updateBotReplyToolCalls`。 */
export function updateBotReplyToolCalls(
  toolCalls: Map<string, BotReplyToolCall>,
  event: ZCodeStreamEvent,
): void {
  if (event.type === "tool_call") {
    toolCalls.set(event.toolId, {
      toolId: event.toolId,
      parentToolUseId: event.parentToolUseId ?? null,
      title: event.title,
      kind: event.kind,
      input: event.input,
      raw: event.raw,
      status: "pending",
    });
    return;
  }
  if (event.type !== "tool_call_update") {
    return;
  }
  const current = toolCalls.get(event.toolId) ?? { toolId: event.toolId };
  toolCalls.set(event.toolId, {
    ...current,
    parentToolUseId: event.parentToolUseId ?? current.parentToolUseId ?? null,
    title: event.title ?? current.title,
    kind: event.kind ?? current.kind,
    input: event.input ?? current.input,
    output: event.content ?? current.output,
    status: event.status,
    error: event.error ?? current.error,
    raw: event.raw ?? current.raw,
  });
}

/** 发布包 host `createAssistantReplyBlocks`。 */
export function createAssistantReplyBlocks(
  parts: readonly ZCodeAssistantMessagePart[],
  toolCalls: ReadonlyMap<string, BotReplyToolCall>,
  mode?: BotReplyMode,
  changeSummary?: ZCodeTaskChangeSummary | null,
): BotAssistantReplyBlock[] {
  const blocks: BotAssistantReplyBlock[] = [];
  const replyMode = mode ?? getDefaultBotReplyGranularity();
  const presentation = buildZCodeAssistantPresentation({
    content: "",
    toolCalls: [...toolCalls.values()].map((toolCall) => ({
      ...toolCall,
      kind: toolCall.kind ?? "tool",
      input: toolCall.input,
      status: toolCall.status ?? "pending",
    })),
    parts,
  });
  if (replyMode === "summary_changes") {
    if (presentation.latestPart?.content.trim()) {
      blocks.push({ type: "content", content: presentation.latestPart.content });
    }
  } else {
    for (const block of presentation.blocks) {
      if (block.type === "content" && block.content.trim()) {
        blocks.push({ type: "content", content: block.content });
        continue;
      }
      if (replyMode !== "assistant_toolcalls_changes" || block.type !== "tool-call") {
        continue;
      }
      const stored = toolCalls.get(block.toolCall.toolId);
      if (stored) {
        blocks.push({ type: "tool-call", toolCall: stored });
      }
    }
  }
  if (changeSummary && changeSummary.fileCount > 0 && changeSummary.files.length > 0) {
    blocks.push({ type: "change-summary", changeSummary });
  }
  return blocks;
}

/** 发布包 host `formatBotAssistantReplyBlocks`。 */
export function formatBotAssistantReplyBlocks(
  blocks: readonly BotAssistantReplyBlock[],
  context?: BotReplyFormatContext,
): string[] {
  const messages: string[] = [];
  for (const block of blocks) {
    if (block.type === "content") {
      messages.push(...splitLongReplyText(block.content.replace(/\r\n/g, "\n")));
      continue;
    }
    if (block.type === "tool-call") {
      messages.push(...splitLongReplyText(formatBotToolCallReply(block.toolCall, context)));
      continue;
    }
    const summary = formatBotChangeSummary(block.changeSummary, context);
    if (summary) {
      messages.push(...splitLongReplyText(summary));
    }
  }
  return messages;
}

import {
  isFeishuBotProvider,
  normalizeBotReplyGranularity,
  type ZCodeAssistantMessagePart,
} from "@zcode/shared";
import {
  FEISHU_STREAMING_CARD_FAILURE_LIMIT,
  FEISHU_STREAMING_CARD_REQUEST_TIMEOUT_MS,
  FEISHU_STREAMING_CARD_RETRY_BASE_MS,
  FEISHU_STREAMING_CARD_SYNC_MIN_INTERVAL_MS,
} from "./botsConstants.js";
import { copy } from "./botsInboundText.js";
import type { BotInboundTaskRuntime } from "./botsInboundRuntime.js";
import { formatBotToolCallSummaryLine, type BotReplyToolCall } from "./botsReplyFormat.js";
import type { BotStreamingReplyCardState } from "./botsTypes.js";

export interface PublishedTaskStreamSession {
  parts: ZCodeAssistantMessagePart[];
  assistantBuffer: string;
  sentReply: boolean;
  seenToolIds: Set<string>;
  toolCalls: Map<string, BotReplyToolCall>;
  repliedToolIds: Set<string>;
  card: {
    handle: { providerMessageId: string } | null;
    cardIndex: number;
    blocks: Array<{ type: "message"; text: string } | { type: "tools"; toolIds: string[] }>;
    status: BotStreamingReplyCardState["status"];
    lastSyncAt: number;
    failureCount: number;
    retryNotBefore: number;
    circuitOpen: boolean;
    chain: Promise<void>;
  };
}

/** 发布包 host `watchTaskStream` 订阅闭包里的回复与卡片状态。 */
export function createPublishedTaskStreamSession(): PublishedTaskStreamSession {
  return {
    parts: [],
    assistantBuffer: "",
    sentReply: false,
    seenToolIds: new Set(),
    toolCalls: new Map(),
    repliedToolIds: new Set(),
    card: {
      handle: null,
      cardIndex: 0,
      blocks: [],
      status: "running",
      lastSyncAt: 0,
      failureCount: 0,
      retryNotBefore: 0,
      circuitOpen: false,
      chain: Promise.resolve(),
    },
  };
}

/** 发布包 host `supportsStreamingCardReply`。 */
export function supportsStreamingCardReply(
  runtime: Pick<BotInboundTaskRuntime, "providers">,
  bot: Parameters<BotInboundTaskRuntime["startTyping"]>[0],
): boolean {
  const provider = runtime.providers[bot.provider];
  return (
    normalizeBotReplyGranularity(bot.provider, bot.replyMode) === "streaming_card" &&
    isFeishuBotProvider(bot.provider) &&
    !!provider?.createStreamingReplyCard &&
    !!provider?.updateStreamingReplyCard
  );
}

/** 发布包 host `appendStreamingCardMessageChunk`。 */
export function appendStreamingCardMessageChunk(
  session: PublishedTaskStreamSession,
  text: string | undefined,
): void {
  if (!text) {
    return;
  }
  const last = session.card.blocks.at(-1);
  if (last?.type === "message") {
    last.text += text;
    return;
  }
  session.card.blocks.push({ type: "message", text });
}

/** 发布包 host `appendStreamingCardMessages`。 */
export function appendStreamingCardMessages(
  session: PublishedTaskStreamSession,
  messages: readonly string[],
): void {
  for (const text of messages.map((item) => item.trim()).filter(Boolean)) {
    const last = session.card.blocks.at(-1);
    if (last?.type === "message" && last.text.trim()) {
      last.text = `${last.text.trim()}\n\n${text}`;
    } else {
      session.card.blocks.push({ type: "message", text });
    }
  }
}

/** 发布包 host `hasStreamingCardMessageText`。 */
export function hasStreamingCardMessageText(session: PublishedTaskStreamSession): boolean {
  return session.card.blocks.some(
    (block) => block.type === "message" && block.text.trim().length > 0,
  );
}

/** 发布包 host `appendStreamingCardTool`。 */
export function appendStreamingCardTool(session: PublishedTaskStreamSession, toolId: string): void {
  if (
    session.card.blocks.some((block) => block.type === "tools" && block.toolIds.includes(toolId))
  ) {
    return;
  }
  const last = session.card.blocks.at(-1);
  if (last?.type === "tools") {
    last.toolIds.push(toolId);
    return;
  }
  session.card.blocks.push({ type: "tools", toolIds: [toolId] });
}

function buildStreamingCardBlocks(
  session: PublishedTaskStreamSession,
  locale: string,
  workspacePath: string,
): BotStreamingReplyCardState["blocks"] {
  const title = copy(locale, "streamingToolSummaries");
  const lastToolsIndex = session.card.blocks.reduce(
    (found, block, index) => (block.type === "tools" ? index : found),
    -1,
  );
  const rendered: BotStreamingReplyCardState["blocks"] = [];
  for (const [index, block] of session.card.blocks.entries()) {
    if (block.type === "message") {
      const text = block.text.trim();
      if (text) {
        rendered.push({ type: "message", text });
      }
      continue;
    }
    const summaries = block.toolIds
      .map((toolId) => session.toolCalls.get(toolId))
      .filter((toolCall): toolCall is BotReplyToolCall => !!toolCall)
      .map((toolCall) => formatBotToolCallSummaryLine(toolCall, { workspacePath, locale }));
    if (summaries.length === 0) {
      continue;
    }
    rendered.push({
      type: "tools",
      title,
      summaries,
      expanded: session.card.status === "running" && index === lastToolsIndex,
    });
  }
  if (rendered.length === 0) {
    rendered.push({ type: "message", text: copy(locale, "streamingWorking") });
  }
  return rendered;
}

/** 发布包 host `syncStreamingCardReply`。 */
export async function syncStreamingCardReply(
  runtime: Pick<
    BotInboundTaskRuntime,
    "providers" | "streamingCardAborts" | "readMessageLocale" | "logger"
  >,
  bot: Parameters<BotInboundTaskRuntime["startTyping"]>[0],
  actor: { providerUserId: string },
  context: { workspacePath: string; activeTaskId: string | null },
  session: PublishedTaskStreamSession,
  trigger: string,
  force = false,
): Promise<void> {
  if (!supportsStreamingCardReply(runtime, bot)) {
    return;
  }
  const now = Date.now();
  if (
    session.card.circuitOpen ||
    now < session.card.retryNotBefore ||
    (session.card.handle &&
      !force &&
      now - session.card.lastSyncAt < FEISHU_STREAMING_CARD_SYNC_MIN_INTERVAL_MS)
  ) {
    return;
  }
  const provider = runtime.providers[bot.provider];
  const locale = await runtime.readMessageLocale();
  const state: BotStreamingReplyCardState = {
    providerUserId: actor.providerUserId,
    locale: locale === "en-US" ? "en-US" : "zh-CN",
    blocks: buildStreamingCardBlocks(session, locale, context.workspacePath),
    status: session.card.status,
  };
  const states = provider?.splitStreamingReplyCardStates?.(state) ?? [state];
  session.card.chain = session.card.chain
    .catch(() => undefined)
    .then(async () => {
      let operation = session.card.handle ? "update" : "create";
      const controller = new AbortController();
      runtime.streamingCardAborts.add(controller);
      const timer = setTimeout(() => {
        controller.abort(new Error("Feishu streaming card request timed out."));
      }, FEISHU_STREAMING_CARD_REQUEST_TIMEOUT_MS);
      try {
        for (
          let index = Math.min(session.card.cardIndex, states.length - 1);
          index < states.length;
          index += 1
        ) {
          const next = states[index];
          if (!next) {
            continue;
          }
          operation = session.card.handle ? "update" : "create";
          const request = session.card.handle
            ? provider?.updateStreamingReplyCard?.(
                bot,
                session.card.handle,
                next,
                controller.signal,
              )
            : provider?.createStreamingReplyCard?.(bot, next, controller.signal);
          const created = await Promise.race([
            request,
            new Promise<never>((_resolve, reject) => {
              controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
                once: true,
              });
            }),
          ]);
          if (!session.card.handle) {
            session.card.handle =
              created && typeof created === "object" && "providerMessageId" in created
                ? created
                : null;
            if (!session.card.handle) {
              throw new Error("Feishu create streaming card returned no message_id.");
            }
          }
          if (index < states.length - 1) {
            session.card.cardIndex = index + 1;
            session.card.handle = null;
          }
        }
        session.card.lastSyncAt = Date.now();
        session.card.failureCount = 0;
        session.card.retryNotBefore = 0;
      } catch (error) {
        session.card.failureCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        if (session.card.failureCount >= FEISHU_STREAMING_CARD_FAILURE_LIMIT) {
          session.card.circuitOpen = true;
          runtime.logger.warn(
            undefined,
            `Feishu streaming card circuit opened task=${context.activeTaskId} trigger=${trigger} operation=${operation} failures=${session.card.failureCount}: ${message}`,
          );
        } else {
          const retryDelayMs =
            FEISHU_STREAMING_CARD_RETRY_BASE_MS * 2 ** (session.card.failureCount - 1);
          session.card.retryNotBefore = Date.now() + retryDelayMs;
          runtime.logger.warn(
            undefined,
            `Feishu streaming card sync failed task=${context.activeTaskId} trigger=${trigger} operation=${operation} failures=${session.card.failureCount} retryDelayMs=${retryDelayMs}: ${message}`,
          );
        }
      } finally {
        clearTimeout(timer);
        runtime.streamingCardAborts.delete(controller);
      }
    });
  await session.card.chain;
}

/** 发布包 host `sealStreamingCardReply`。 */
export async function sealStreamingCardReply(
  runtime: Pick<
    BotInboundTaskRuntime,
    "providers" | "streamingCardAborts" | "readMessageLocale" | "logger"
  >,
  bot: Parameters<BotInboundTaskRuntime["startTyping"]>[0],
  actor: { providerUserId: string },
  context: { workspacePath: string; activeTaskId: string | null },
  session: PublishedTaskStreamSession,
): Promise<void> {
  if (!session.card.handle) {
    return;
  }
  session.card.status = "sealed";
  await syncStreamingCardReply(runtime, bot, actor, context, session, "seal", true);
  session.card.handle = null;
  session.card.cardIndex = 0;
  session.card.blocks.length = 0;
  session.card.status = "running";
  session.card.lastSyncAt = 0;
}

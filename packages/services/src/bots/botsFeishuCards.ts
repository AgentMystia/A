import { formatBotMessage, normalizeBotMessageLocale } from "./botsCopy.js";
import { FEISHU_STREAMING_CARD_TAG_LIMIT, FEISHU_TEXT_CHUNK } from "./botsConstants.js";
import type { BotProviderOutbound } from "@zcode/shared";
import type { BotSelection } from "./botsTypes.js";

export function splitFeishuText(text: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += FEISHU_TEXT_CHUNK) {
    chunks.push(text.slice(index, index + FEISHU_TEXT_CHUNK));
  }
  return chunks.length > 0 ? chunks : [text];
}

/** 发布包 host `formatFeishuCardMarkdownContent`：围栏外的硬换行改成两个空格。 */
export function formatFeishuCardMarkdownContent(text: string): string {
  const lines: Array<{ text: string; hardBreak: boolean }> = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
    }
    if (!inFence && /^-{3,}$/u.test(line.trim())) {
      if (lines.length > 0 && lines.at(-1)?.text !== "") {
        lines.push({ text: "", hardBreak: false });
      }
      lines.push({ text: "---", hardBreak: false }, { text: "", hardBreak: false });
      continue;
    }
    lines.push({ text: line, hardBreak: !inFence });
  }
  return lines
    .map((line, index) =>
      !line.text || !line.hardBreak || index >= lines.length - 1 || !lines[index + 1]?.text
        ? line.text
        : `${line.text}  `,
    )
    .join("\n");
}

function formatSelectionCommand(selection: BotSelection, optionId: string): string {
  if (selection.action === "permission.respond") {
    return optionId;
  }
  if (selection.action === "elicitation.respond") {
    return selection.token
      ? `/elicitation ${selection.token} ${optionId}`
      : `/elicitation ${optionId}`;
  }
  if (selection.action === "model.provider.set") {
    return `/model provider ${optionId}`;
  }
  if (selection.action === "model.set") {
    return `/model model ${optionId}`;
  }
  return `/${selection.action.replace(".set", "")} ${optionId}`;
}

function buildFeishuButtonElement(input: {
  text: string;
  type: string;
  command: string;
  originalText: string;
}): Record<string, unknown> {
  return {
    tag: "button",
    text: { tag: "plain_text", content: input.text },
    type: input.type,
    behaviors: [
      { type: "callback", value: { command: input.command, zcodeCardText: input.originalText } },
    ],
  };
}

export function buildFeishuInteractiveCardPayload(
  outbound: BotProviderOutbound,
): Record<string, unknown> {
  const selection = outbound.selection as BotSelection | undefined;
  const elements: unknown[] = [
    { tag: "markdown", content: formatFeishuCardMarkdownContent(outbound.text) },
  ];
  if (selection) {
    elements.push(
      ...selection.options.map((option, index) =>
        buildFeishuButtonElement({
          text: option.label || String(index + 1),
          type: "primary",
          command: formatSelectionCommand(selection, option.id),
          originalText: outbound.text,
        }),
      ),
      ...(selection.showCancel === false
        ? []
        : [
            buildFeishuButtonElement({
              text:
                selection.cancelLabel ?? formatBotMessage(outbound.locale, "selectionCancelOption"),
              type: "default",
              command: "/cancel",
              originalText: outbound.text,
            }),
          ]),
    );
  }
  return { schema: "2.0", config: { wide_screen_mode: true }, body: { elements } };
}

export interface FeishuStreamingCardState {
  providerUserId?: string;
  locale?: BotProviderOutbound["locale"];
  status: "running" | "completed" | "error" | "sealed";
  blocks: Array<
    | { type: "message"; text: string }
    | { type: "tools"; summaries: string[]; expanded?: boolean; title?: string }
  >;
}

function formatFeishuStreamingStatus(state: FeishuStreamingCardState): string {
  const locale = normalizeBotMessageLocale(state.locale);
  if (state.status === "completed") {
    return formatBotMessage(locale, "streamingStatusCompleted");
  }
  if (state.status === "error") {
    return formatBotMessage(locale, "streamingStatusFailed");
  }
  return formatBotMessage(locale, "streamingStatusRunning");
}

function countTaggedElements(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + countTaggedElements(item), 0);
  }
  if (!value || typeof value !== "object") {
    return 0;
  }
  const record = value as Record<string, unknown>;
  return (
    (typeof record.tag === "string" ? 1 : 0) +
    Object.values(record).reduce<number>((sum, item) => sum + countTaggedElements(item), 0)
  );
}

export function buildFeishuStreamingCardPayload(
  state: FeishuStreamingCardState,
): Record<string, unknown> {
  const elements: unknown[] = [];
  for (const block of state.blocks) {
    if (block.type === "message") {
      const text = block.text.trim();
      if (text) {
        elements.push({ tag: "markdown", content: formatFeishuCardMarkdownContent(text) });
      }
      continue;
    }
    const summaries = block.summaries.map((item) => item.trim()).filter((item) => item.length > 0);
    if (summaries.length === 0) {
      continue;
    }
    elements.push({
      tag: "collapsible_panel",
      expanded: block.expanded ?? state.status === "running",
      header: {
        title: {
          tag: "plain_text",
          content: `🛠️ ${block.title?.trim() || formatBotMessage(state.locale, "streamingToolSummaries")} (${summaries.length})`,
        },
      },
      elements: [
        { tag: "markdown", content: formatFeishuCardMarkdownContent(summaries.join("\n")) },
      ],
    });
  }
  if (elements.length === 0) {
    elements.push({ tag: "markdown", content: " " });
  }
  if (state.status !== "sealed") {
    elements.push({
      tag: "markdown",
      content: formatFeishuCardMarkdownContent(`_${formatFeishuStreamingStatus(state)}_`),
    });
  }
  return { schema: "2.0", config: { wide_screen_mode: true }, body: { elements } };
}

export function splitFeishuStreamingCardStates(
  state: FeishuStreamingCardState,
): FeishuStreamingCardState[] {
  const groups: FeishuStreamingCardState["blocks"][] = [];
  let current: FeishuStreamingCardState["blocks"] = [];
  for (const block of state.blocks) {
    const next = [...current, block];
    const candidate: FeishuStreamingCardState = { ...state, blocks: next, status: "running" };
    if (
      current.length > 0 &&
      countTaggedElements(buildFeishuStreamingCardPayload(candidate)) >
        FEISHU_STREAMING_CARD_TAG_LIMIT
    ) {
      groups.push(current);
      current = [block];
    } else {
      current = next;
    }
  }
  groups.push(current);
  return groups.map((blocks, index) => ({
    ...state,
    blocks,
    status: index === groups.length - 1 ? state.status : "sealed",
  }));
}

export function buildFeishuElicitationCardPayload(
  outbound: BotProviderOutbound,
): Record<string, unknown> {
  return outbound.elicitation
    ? buildFeishuInteractiveCardPayload(outbound)
    : buildFeishuInteractiveCardPayload(outbound);
}

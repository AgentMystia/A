import { getCompactToolCallSummary, type ToolCallChangeStat } from "@zcode/shared";
import {
  BOT_DIFF_ADDED,
  BOT_DIFF_REMOVED,
  BOT_REPLY_FILE_LIMIT,
  BOT_REPLY_TEXT_LIMIT,
  BOT_TRUNCATE_MIDDLE_LIMIT,
  BOT_TRUNCATE_TEXT_LIMIT,
} from "./botsConstants.js";
import { formatBotMessage, type BotMessageLocale } from "./botsCopy.js";

export interface BotReplyToolCall {
  toolId: string;
  parentToolUseId?: string | null;
  title?: string;
  kind?: string;
  input?: unknown;
  output?: unknown;
  status?: string;
  error?: string;
  raw?: unknown;
}

export interface BotReplyFormatContext {
  workspacePath?: string;
  locale?: BotMessageLocale | string;
}

/** 发布包 host `isRecord`：数组不是 record。 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 发布包 host `normalizeInlineText`。 */
export function normalizeInlineText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** 发布包 host `truncateText`。 */
export function truncateText(text: string, limit = BOT_TRUNCATE_TEXT_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

/** 发布包 host `truncateMiddleText`。 */
export function truncateMiddleText(text: string, limit = BOT_TRUNCATE_MIDDLE_LIMIT): string {
  if (text.length <= limit) {
    return text;
  }
  const head = Math.ceil((limit - 5) * 0.65);
  const tail = Math.max(0, limit - 5 - head);
  return `${text.slice(0, head)} ... ${text.slice(text.length - tail)}`;
}

/** 发布包 host `formatMarkdownInlineCode`。 */
export function formatMarkdownInlineCode(text: string): string {
  return `\`${text.replace(/\\/gu, "\\\\").replace(/`/gu, "\\`")}\``;
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/gu, "/");
}

function stripTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/u, "") : value;
}

/** 发布包 host `toWorkspaceRelativePath`。 */
export function toWorkspaceRelativePath(filePath: string, workspacePath?: string): string {
  const normalized = stripTrailingSlash(normalizePathSeparators(filePath.trim()));
  if (!workspacePath?.trim()) {
    return normalized;
  }
  const root = stripTrailingSlash(normalizePathSeparators(workspacePath.trim()));
  const fileKey = normalized.toLowerCase();
  const rootKey = root.toLowerCase();
  if (fileKey === rootKey) {
    return ".";
  }
  return fileKey.startsWith(`${rootKey}/`) ? normalized.slice(root.length + 1) : normalized;
}

/** 发布包 host `normalizeToolCallSummaryInput`。 */
export function normalizeToolCallSummaryInput(
  toolCall: Pick<BotReplyToolCall, "input" | "kind">,
  context?: BotReplyFormatContext,
): unknown {
  if (!isPlainRecord(toolCall.input) || toolCall.kind !== "edit") {
    return toolCall.input;
  }
  const next = { ...toolCall.input };
  for (const key of ["path", "file_path", "filePath"]) {
    const value = next[key];
    if (typeof value === "string") {
      next[key] = toWorkspaceRelativePath(value, context?.workspacePath);
    }
  }
  return next;
}

/** 发布包 host `formatBotDiffCount`。 */
export function formatBotDiffCount(stat: ToolCallChangeStat): string {
  const parts: string[] = [];
  if (stat.added > 0) {
    parts.push(`${BOT_DIFF_ADDED} ${formatMarkdownInlineCode(`+${stat.added}`)}`);
  }
  if (stat.removed > 0) {
    parts.push(`${BOT_DIFF_REMOVED} ${formatMarkdownInlineCode(`-${stat.removed}`)}`);
  }
  return parts.join(" ");
}

/** 发布包 host `formatCompactSummaryDetail`。 */
export function formatCompactSummaryDetail(summary: {
  secondaryText?: string;
  changeStat?: ToolCallChangeStat;
}): string | undefined {
  const parts: string[] = [];
  if (summary.secondaryText) {
    parts.push(
      formatMarkdownInlineCode(truncateMiddleText(normalizeInlineText(summary.secondaryText))),
    );
  }
  if (summary.changeStat) {
    const diff = formatBotDiffCount(summary.changeStat);
    if (diff) {
      parts.push(diff);
    }
  }
  return parts.length > 0 ? parts.join(" \u00b7 ") : undefined;
}

/** 发布包 host `formatToolStatus`。 */
export function formatToolStatus(
  status: string | undefined,
  error: string | undefined,
  locale: string | undefined,
): string {
  if (status === "completed") {
    return formatBotMessage(locale, "completed");
  }
  if (status === "failed") {
    return `${formatBotMessage(locale, "failed")}${error ? `: ${truncateText(normalizeInlineText(error))}` : ""}`;
  }
  if (status === "denied") {
    return formatBotMessage(locale, "denied");
  }
  if (status === "in_progress") {
    return formatBotMessage(locale, "inProgress");
  }
  return formatBotMessage(locale, "pending");
}

/** 发布包 host `formatBotToolCallSummaryLine`。 */
export function formatBotToolCallSummaryLine(
  toolCall: BotReplyToolCall,
  context?: BotReplyFormatContext,
): string {
  const summary = getCompactToolCallSummary({
    title: toolCall.title,
    kind: toolCall.kind ?? "tool",
    input: normalizeToolCallSummaryInput(toolCall, context),
    output: toolCall.output,
    raw: toolCall.raw,
  });
  const status = formatToolStatus(toolCall.status, toolCall.error, context?.locale);
  const detail = formatCompactSummaryDetail(summary);
  return `- ${status} \u00b7 ${summary.primaryText}${detail ? ` \u00b7 ${detail}` : ""}`;
}

/** 发布包 host `splitLongReplyText`。 */
export function splitLongReplyText(text: string, limit = BOT_REPLY_TEXT_LIMIT): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const splitAt = Math.max(rest.lastIndexOf("\n", limit), rest.lastIndexOf(" ", limit));
    const index = splitAt > 0 ? splitAt : limit;
    chunks.push(rest.slice(0, index).trim());
    rest = rest.slice(index).trim();
  }
  if (rest) {
    chunks.push(rest);
  }
  return chunks;
}

/** 发布包 host `extractBotAssistantResponseMessages`：force=false 不发 partial。 */
export function extractBotAssistantResponseMessages(
  text: string,
  force = false,
): { messages: string[]; rest: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  return force
    ? { messages: splitLongReplyText(normalized), rest: "" }
    : { messages: [], rest: normalized };
}

/** 发布包 host `formatBotToolCallReply`。 */
export function formatBotToolCallReply(
  toolCall: BotReplyToolCall,
  context?: BotReplyFormatContext,
): string {
  return `${formatBotMessage(context?.locale, "toolCalls")}\n${formatBotToolCallSummaryLine(toolCall, context)}`;
}

/** 发布包 host `isBotToolCallReplyTerminal`。 */
export function isBotToolCallReplyTerminal(status: string | undefined): boolean {
  return (
    status === "completed" || status === "failed" || status === "denied" || status === "stopped"
  );
}

/** 发布包 host `formatBotChangeSummary`。 */
export function formatBotChangeSummary(
  summary:
    | {
        fileCount: number;
        added: number;
        removed: number;
        files: Array<{ path: string; added: number; removed: number }>;
      }
    | null
    | undefined,
  context?: BotReplyFormatContext,
): string {
  if (!summary || summary.fileCount <= 0 || summary.files.length === 0) {
    return "";
  }
  const diff = formatBotDiffCount(summary);
  const header =
    context?.locale === "en-US"
      ? `${formatBotMessage(context.locale, "changeSummary")}: ${summary.fileCount} files, ${diff}`
      : `${formatBotMessage(context?.locale, "changeSummary")}\uFF1A${summary.fileCount} \u4E2A\u6587\u4EF6\uFF0C${diff}`;
  const lines = [header];
  for (const file of summary.files.slice(0, BOT_REPLY_FILE_LIMIT)) {
    lines.push(`- ${formatMarkdownInlineCode(file.path)} (${formatBotDiffCount(file)})`);
  }
  if (summary.files.length > BOT_REPLY_FILE_LIMIT) {
    lines.push(
      `- ${formatBotMessage(context?.locale, "moreFiles").replace("{count}", String(summary.files.length - BOT_REPLY_FILE_LIMIT))}`,
    );
  }
  return lines.join("\n");
}

import type {
  ZCodePersistedFileChange,
  ZCodeStreamEvent,
  ZCodeTaskChangeSummary,
} from "@zcode/shared";
import { buildPerTurnChangeSummaries } from "../session/taskChangeSummary.js";
import { BOT_LIVE_STATUS_TEXT_LIMIT, BOT_STATUS_PROGRESS_TEXT_LIMIT } from "./botsConstants.js";
import { taskStatus } from "./botsHostHelpers.js";
import type { LiveStatusProgress } from "./botsInboundRuntime.js";
import { isPlainRecord, normalizeInlineText } from "./botsReplyFormat.js";

const MS_SECOND = 1_000;
const MS_MINUTE = 60 * MS_SECOND;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;

const STATUS_DETAIL_KEYS = ["command", "path", "file_path", "filePath", "prompt"] as const;

interface StatusMessage {
  role: string;
  content?: unknown;
  thought?: unknown;
  timestamp?: number;
  durationMs?: number;
  turnIndex?: number;
  parts?: ReadonlyArray<{ type: string; content?: string; toolIndex?: number }>;
  tools?: ReadonlyArray<StatusTool | undefined>;
}

interface StatusTool {
  title?: string;
  toolName?: string;
  kind?: string;
  status?: string;
  input?: unknown;
  output?: unknown;
  raw?: unknown;
}

interface StatusSnapshot {
  messages?: readonly StatusMessage[];
  fileChanges?: readonly ZCodePersistedFileChange[];
}

/** 发布包 host `truncateStatusProgressText`。 */
export function truncateStatusProgressText(
  text: string,
  limit = BOT_STATUS_PROGRESS_TEXT_LIMIT,
): string {
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

/** 发布包 host `truncateLiveStatusProgressText`：保留尾部。 */
export function truncateLiveStatusProgressText(
  text: string,
  limit = BOT_LIVE_STATUS_TEXT_LIMIT,
): string {
  return text.length > limit ? text.slice(text.length - limit) : text;
}

/** 发布包 host `readStatusStringField`。 */
export function readStatusStringField(value: unknown, keys: readonly string[]): string | null {
  if (typeof value === "string") {
    return normalizeInlineText(value) || null;
  }
  if (!isPlainRecord(value)) {
    return null;
  }
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "string") {
      const normalized = normalizeInlineText(field);
      if (normalized) {
        return normalized;
      }
    }
  }
  return null;
}

/** 发布包 host `formatStatusToolProgress`。 */
export function formatStatusToolProgress(tool: StatusTool | null | undefined): string | null {
  if (!tool) {
    return null;
  }
  const title = normalizeInlineText(tool.title ?? tool.toolName ?? tool.kind ?? "tool");
  const detail =
    readStatusStringField(tool.input, STATUS_DETAIL_KEYS) ??
    readStatusStringField(tool.output, STATUS_DETAIL_KEYS) ??
    readStatusStringField(tool.raw, STATUS_DETAIL_KEYS);
  const status = tool.status ? ` [${tool.status}]` : "";
  return detail ? `${title}${status}: ${detail}` : `${title}${status}`;
}

/** 发布包 host `formatStatusStreamToolProgress`。 */
export function formatStatusStreamToolProgress(
  event: Extract<ZCodeStreamEvent, { type: "tool_call" | "tool_call_update" }>,
): string {
  const title = normalizeInlineText(event.title ?? event.kind ?? "tool");
  const detail =
    readStatusStringField(event.input, STATUS_DETAIL_KEYS) ??
    ("content" in event ? readStatusStringField(event.content, STATUS_DETAIL_KEYS) : null) ??
    readStatusStringField(event.raw, STATUS_DETAIL_KEYS);
  const status = "status" in event && event.status ? ` [${event.status}]` : "";
  return detail ? `${title}${status}: ${detail}` : `${title}${status}`;
}

/** 发布包 host `readLatestTaskProgress`。 */
export function readLatestTaskProgress(snapshot: StatusSnapshot | null | undefined): string | null {
  const messages = snapshot?.messages ?? [];
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const part of [...(message.parts ?? [])].reverse()) {
      if ((part.type === "content" || part.type === "thought") && part.content?.trim()) {
        return truncateStatusProgressText(normalizeInlineText(part.content));
      }
      if (part.type === "tool-call") {
        const tool = formatStatusToolProgress(message.tools?.[part.toolIndex ?? -1]);
        if (tool) {
          return truncateStatusProgressText(tool);
        }
      }
    }
    const fallback =
      readStatusStringField(message.content, []) ??
      readStatusStringField(message.thought, []) ??
      formatStatusToolProgress(message.tools?.at(-1));
    if (fallback) {
      return truncateStatusProgressText(fallback);
    }
  }
  return null;
}

/** 发布包 host `updateLiveStatusProgress`。唯一写入 liveStatusProgress。 */
export function updateLiveStatusProgress(
  progress: Map<string, LiveStatusProgress>,
  event: ZCodeStreamEvent,
): void {
  if (event.type === "agent_message_chunk" || event.type === "agent_thought_chunk") {
    const text = normalizeInlineText(event.content);
    if (!text) {
      return;
    }
    const kind = event.type === "agent_message_chunk" ? "message" : "thought";
    const previous = progress.get(event.taskId);
    progress.set(event.taskId, {
      kind,
      text: truncateLiveStatusProgressText(
        previous?.kind === kind ? `${previous.text}${text}` : text,
      ),
    });
    return;
  }
  if (event.type === "tool_call" || event.type === "tool_call_update") {
    const text = formatStatusStreamToolProgress(event);
    if (text) {
      progress.set(event.taskId, { kind: "tool", text });
    }
  }
}

/** 发布包 host `formatTaskRunningDuration`。 */
export function formatTaskRunningDuration(durationMs: number): string {
  const duration = Math.max(durationMs, 0);
  const days = Math.floor(duration / MS_DAY);
  const hours = Math.floor((duration % MS_DAY) / MS_HOUR);
  const minutes = Math.floor((duration % MS_HOUR) / MS_MINUTE);
  const seconds = Math.floor((duration % MS_MINUTE) / MS_SECOND);
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }
  return parts.join(" ");
}

/** 发布包 host `readRunningTaskStartedAt`。 */
export function readRunningTaskStartedAt(
  snapshot: StatusSnapshot | null | undefined,
  task: { createdAt?: number; updatedAt?: number },
): number | null {
  const messages = snapshot?.messages ?? [];
  const assistantAt = findLast(messages, (message) => message.role === "assistant")?.timestamp;
  if (assistantAt !== undefined) {
    return assistantAt;
  }
  const userAt = findLast(messages, (message) => message.role === "user")?.timestamp;
  if (userAt !== undefined) {
    return userAt;
  }
  return task.createdAt ?? task.updatedAt ?? null;
}

/** 发布包 host `readTaskWorkedDurationMs`。 */
export function readTaskWorkedDurationMs(
  snapshot: StatusSnapshot | null | undefined,
  task: { status?: string | null; createdAt?: number; updatedAt?: number },
): number | null {
  if (taskStatus(task) === "running") {
    const startedAt = readRunningTaskStartedAt(snapshot, task);
    return startedAt === null ? null : Math.max(Date.now() - startedAt, 0);
  }
  const duration = findLast(
    snapshot?.messages ?? [],
    (message) => message.role === "assistant",
  )?.durationMs;
  if (duration !== undefined) {
    return duration;
  }
  if (
    task.updatedAt !== undefined &&
    task.createdAt !== undefined &&
    task.updatedAt >= task.createdAt
  ) {
    return task.updatedAt - task.createdAt;
  }
  return null;
}

/** 发布包 host `readLatestAssistantTurnChangeSummary`。 */
export function readLatestAssistantTurnChangeSummary(
  snapshot: StatusSnapshot | null | undefined,
): ZCodeTaskChangeSummary | null {
  if (!snapshot?.fileChanges || snapshot.fileChanges.length === 0) {
    return null;
  }
  const turnIndex = findLast(
    snapshot.messages ?? [],
    (message) => message.role === "assistant" && message.turnIndex !== undefined,
  )?.turnIndex;
  if (turnIndex === undefined) {
    return null;
  }
  const summary = buildPerTurnChangeSummaries(snapshot.fileChanges).get(turnIndex) ?? null;
  return summary && summary.fileCount > 0 && summary.files.length > 0 ? summary : null;
}

/** 发布包 host `buildStatusText` 的进展行：map 优先，否则 snapshot。 */
export const readStatusProgressText = (() => {
  return (
    progress: Map<string, LiveStatusProgress>,
    activeTaskId: string | null | undefined,
    meta: { status?: string | null } | null,
    snapshot: StatusSnapshot | null | undefined,
  ): string | null => {
    if (!activeTaskId || (meta && taskStatus(meta) !== "running")) {
      return null;
    }
    return progress.get(activeTaskId)?.text ?? readLatestTaskProgress(snapshot);
  };
})();

function findLast<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item && predicate(item)) {
      return item;
    }
  }
  return undefined;
}

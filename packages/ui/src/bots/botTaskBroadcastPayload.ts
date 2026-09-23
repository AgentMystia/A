import {
  type ZCodeConfigOption,
  type ZCodeElicitationRequest,
  type ZCodePermissionRequest,
  type ZCodeStreamEvent,
  type ZCodeTaskMeta,
  type ZCodeTaskRuntimeStatus,
} from "@zcode/shared";
import { resolveWorkspaceStateKey } from "@/store/zcodeSessionStoreSelectors.js";
import type { TaskUsageState } from "@/store/zcodeSessionStore.js";
import { isWorkspaceTab, type WindowTabState } from "@/store/tabStore.js";

const BOT_TASK_LIST_EVENTS = new Set([
  "created",
  "prompt_sent",
  "resumed",
  "streaming",
  "permission_request",
  "permission_resolved",
  "elicitation_request",
  "elicitation_resolved",
  "updated",
  "completed",
  "error",
]);

export interface BotTaskListPayload {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
  updatedAt: number;
  event: string;
  task?: ZCodeTaskMeta;
  provider?: string;
  configOptions?: ZCodeConfigOption[];
  permissionRequest?: ZCodePermissionRequest;
  elicitationRequest?: ZCodeElicitationRequest;
  prompt?: { content: string; messageId: string; sentAt: number };
  requestId?: string;
  error?: string;
}

export interface BotTaskStreamPayload {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
  updatedAt: number;
  event: ZCodeStreamEvent;
}

export function botTaskListRuntimeStatus(event: string): ZCodeTaskRuntimeStatus | undefined {
  switch (event) {
    case "created":
      return "creating";
    case "completed":
      return "completed";
    case "error":
      return "failed";
    case "prompt_sent":
    case "resumed":
    case "streaming":
    case "permission_request":
    case "permission_resolved":
    case "elicitation_request":
    case "elicitation_resolved":
      return "streaming";
    case "updated":
      return "ready";
    default:
      return undefined;
  }
}

export function shouldBumpBotTaskList(event: string, hasTask: boolean): boolean {
  // 发布包先对 created 短路，有 task 时不再 bump；后面的 created 比较因此仍然留在包里。
  return event === "created"
    ? true
    : hasTask
      ? false
      : event === "created" || event === "updated" || event === "completed" || event === "error";
}

export function shouldProjectBotTaskStream(input: {
  activeTaskId: string | null;
  taskId: string;
  workspaceIdentity?: string;
}): boolean {
  // 当前 active task 只有带 workspaceIdentity 才吃 bots:task-stream，
  // 避免和 desktop-continuous 双写。其它 task 始终投影。
  return input.activeTaskId === input.taskId ? Boolean(input.workspaceIdentity?.trim()) : true;
}

export function isCompactOrCompressPrompt(prompt: string | undefined): boolean {
  const text = prompt?.trim() ?? "";
  return (
    text === "/compact" ||
    text.startsWith("/compact ") ||
    text === "/compress" ||
    text.startsWith("/compress ")
  );
}

export function mergeBotTaskUsage(input: {
  currentUsage: TaskUsageState | null;
  incomingUsage: TaskUsageState;
  latestUserPrompt?: string;
}): TaskUsageState {
  const { currentUsage, incomingUsage, latestUserPrompt } = input;
  const merged =
    !incomingUsage.breakdown &&
    currentUsage?.breakdown &&
    currentUsage.used === incomingUsage.used &&
    currentUsage.size === incomingUsage.size
      ? { ...incomingUsage, breakdown: currentUsage.breakdown }
      : incomingUsage;
  if (
    currentUsage &&
    Number.isFinite(currentUsage.used) &&
    currentUsage.used > 0 &&
    Number.isFinite(currentUsage.size) &&
    currentUsage.size > 0 &&
    (!Number.isFinite(incomingUsage.used) || incomingUsage.used <= 0) &&
    !isCompactOrCompressPrompt(latestUserPrompt)
  ) {
    return currentUsage;
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function workspaceMatchesOpenTab(
  tabs: readonly WindowTabState[],
  workspacePath: string,
  workspaceIdentity?: string,
): boolean {
  const workspaceKey = resolveWorkspaceStateKey(workspacePath, workspaceIdentity);
  return tabs.some(
    (tab) =>
      isWorkspaceTab(tab) &&
      resolveWorkspaceStateKey(tab.workspacePath, tab.workspaceIdentity) === workspaceKey,
  );
}

function readBotTask(value: unknown): ZCodeTaskMeta | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.taskId !== "string" || typeof value.workspacePath !== "string") {
    return undefined;
  }
  return value as unknown as ZCodeTaskMeta;
}

export function readBotTaskListPayload(value: unknown): BotTaskListPayload | null {
  if (!isRecord(value)) {
    return null;
  }
  const task = value.task === undefined ? undefined : readBotTask(value.task);
  if (value.task !== undefined && !task) {
    return null;
  }
  const prompt = value.prompt;
  const promptOk =
    prompt === undefined ||
    (isRecord(prompt) &&
      typeof prompt.content === "string" &&
      typeof prompt.messageId === "string" &&
      typeof prompt.sentAt === "number");
  if (
    typeof value.workspacePath !== "string" ||
    typeof value.taskId !== "string" ||
    typeof value.updatedAt !== "number" ||
    (value.workspaceIdentity !== undefined && typeof value.workspaceIdentity !== "string") ||
    typeof value.event !== "string" ||
    !BOT_TASK_LIST_EVENTS.has(value.event) ||
    !promptOk ||
    (value.provider !== undefined && typeof value.provider !== "string") ||
    (value.configOptions !== undefined && !Array.isArray(value.configOptions)) ||
    (value.permissionRequest !== undefined && !isRecord(value.permissionRequest)) ||
    (value.elicitationRequest !== undefined && !isRecord(value.elicitationRequest)) ||
    (value.requestId !== undefined && typeof value.requestId !== "string") ||
    (value.error !== undefined && typeof value.error !== "string")
  ) {
    return null;
  }
  return {
    workspacePath: value.workspacePath,
    workspaceIdentity: readOptionalString(value.workspaceIdentity),
    taskId: value.taskId,
    updatedAt: value.updatedAt,
    event: value.event,
    ...(task ? { task } : {}),
    ...(typeof value.provider === "string" ? { provider: value.provider } : {}),
    ...(Array.isArray(value.configOptions)
      ? { configOptions: value.configOptions as ZCodeConfigOption[] }
      : {}),
    ...(isRecord(value.permissionRequest)
      ? { permissionRequest: value.permissionRequest as unknown as ZCodePermissionRequest }
      : {}),
    ...(isRecord(value.elicitationRequest)
      ? { elicitationRequest: value.elicitationRequest as unknown as ZCodeElicitationRequest }
      : {}),
    ...(isRecord(prompt)
      ? {
          prompt: {
            content: prompt.content as string,
            messageId: prompt.messageId as string,
            sentAt: prompt.sentAt as number,
          },
        }
      : {}),
    ...(typeof value.requestId === "string" ? { requestId: value.requestId } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

function readStreamEvent(value: unknown, taskId: string): ZCodeStreamEvent | null {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.taskId !== "string") {
    return null;
  }
  if (value.taskId !== taskId) {
    return null;
  }
  return value as unknown as ZCodeStreamEvent;
}

export function readBotTaskStreamPayload(value: unknown): BotTaskStreamPayload | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.workspacePath !== "string" ||
    typeof value.taskId !== "string" ||
    typeof value.updatedAt !== "number" ||
    (value.workspaceIdentity !== undefined && typeof value.workspaceIdentity !== "string")
  ) {
    return null;
  }
  const event = readStreamEvent(value.event, value.taskId);
  if (!event) {
    return null;
  }
  return {
    workspacePath: value.workspacePath,
    workspaceIdentity: readOptionalString(value.workspaceIdentity),
    taskId: value.taskId,
    updatedAt: value.updatedAt,
    event,
  };
}

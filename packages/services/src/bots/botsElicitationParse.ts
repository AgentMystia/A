import { createHash } from "node:crypto";
import type { BotActor, BotRuntimeState } from "@zcode/shared";
import {
  BOT_ELICITATION_FORM_PREFIX,
  BOT_ELICITATION_SKIP,
  BOT_ELICITATION_SUBMIT,
} from "./botsConstants.js";
import { getActorContextKey } from "./botsInboundText.js";
import { resolveOptionByValue } from "./botsHostHelpers.js";
import type { BotInboundTaskRuntime } from "./botsInboundRuntime.js";
import type { BotSelection } from "./botsTypes.js";

export type PendingElicitation = NonNullable<BotRuntimeState["pendingElicitation"]>;

export function getElicitationAnswerKey(index: number): string {
  return String(index);
}

export function readElicitationAnswerValues(pending: PendingElicitation, index: number): string[] {
  return pending.answers[getElicitationAnswerKey(index)] ?? [];
}

export function getPendingElicitationSelectionToken(pending: PendingElicitation): string {
  return createHash("sha256")
    .update([pending.taskId, pending.runId, pending.requestId, pending.currentQuestionIndex].join("::"))
    .digest("hex")
    .slice(0, 12);
}

export function getPendingElicitationSkipOptionId(pending: PendingElicitation): string {
  return `${BOT_ELICITATION_SKIP}:${getPendingElicitationSelectionToken(pending)}`;
}

export function parseElicitationResponseValue(value: string): { token?: string; value: string } {
  const trimmed = value.trim();
  const [first, ...rest] = trimmed.split(/\s+/u);
  return first && rest.length > 0 && /^[a-f0-9]{12}$/iu.test(first)
    ? { token: first.toLowerCase(), value: rest.join(" ") }
    : { value: trimmed };
}

export function parseElicitationFormValues(value: string): string[] | null {
  if (!value.startsWith(BOT_ELICITATION_FORM_PREFIX)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value.slice(BOT_ELICITATION_FORM_PREFIX.length)));
    return (Array.isArray(parsed) ? parsed : [parsed])
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function mergeElicitationFormValues(
  question: PendingElicitation["questions"][number],
  current: string[],
  incoming: string[],
): string[] {
  const next = incoming.filter(Boolean);
  if (!question.multiSelect) {
    return next.length > 0 ? next.slice(0, 1) : current.slice(0, 1);
  }
  const merged: string[] = [];
  for (const item of [...current, ...next]) {
    if (item && !merged.includes(item)) {
      merged.push(item);
    }
  }
  return merged;
}

export function toggleElicitationCustomAnswerExpanded(pending: PendingElicitation): PendingElicitation {
  const expanded = new Set(pending.expandedCustomAnswerQuestionIndexes ?? []);
  if (expanded.has(pending.currentQuestionIndex)) {
    expanded.delete(pending.currentQuestionIndex);
  } else {
    expanded.add(pending.currentQuestionIndex);
  }
  return { ...pending, expandedCustomAnswerQuestionIndexes: [...expanded].sort((a, b) => a - b) };
}

export function resolveElicitationQuestionValue(
  question: PendingElicitation["questions"][number],
  value: string,
  options: { includeSubmit?: boolean } = {},
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const token = trimmed.toLowerCase();
  if (
    question.multiSelect &&
    options.includeSubmit !== false &&
    ["submit", "done", "完成", "提交", BOT_ELICITATION_SUBMIT].includes(token)
  ) {
    return BOT_ELICITATION_SUBMIT;
  }
  const option = resolveOptionByValue(
    question.options.map((item) => ({ id: item.value, label: item.label })),
    trimmed,
  );
  if (option) {
    return option.id;
  }
  const index = Number.parseInt(trimmed, 10);
  return question.multiSelect &&
    options.includeSubmit !== false &&
    /^[1-9]\d*$/u.test(trimmed) &&
    index === question.options.length + 1
    ? BOT_ELICITATION_SUBMIT
    : trimmed;
}

export function isPendingElicitationOwnedByActor(pending: PendingElicitation, actor: BotActor): boolean {
  return !pending.actorKey || pending.actorKey === getActorContextKey(actor);
}

export function clearPendingElicitationSelection(
  runtime: BotInboundTaskRuntime,
  pending: PendingElicitation,
): void {
  const token = getPendingElicitationSelectionToken(pending);
  for (const [key, selection] of runtime.pendingSelections) {
    if (
      selection.action === "elicitation.respond" &&
      (selection.token === token || selection.id.startsWith(`elicitation-${pending.requestId}-`))
    ) {
      runtime.pendingSelections.delete(key);
    }
  }
}

export function buildBotElicitationContent(
  pending: PendingElicitation,
  answers: PendingElicitation["answers"] = pending.answers,
): Record<string, unknown> {
  const pairs = pending.questions.flatMap((question, index) => {
    const text = (answers[getElicitationAnswerKey(index)] ?? []).join(", ").trim();
    return text ? [[question.question, text] as const] : [];
  });
  const content: Record<string, unknown> = { answers: Object.fromEntries(pairs) };
  pending.questions.forEach((question, index) => {
    const values = answers[getElicitationAnswerKey(index)] ?? [];
    if (values.length > 0) {
      content[`answer_${index}`] = question.multiSelect ? values : values[0];
    }
  });
  if (pending.questions.length === 1) {
    const values = answers[getElicitationAnswerKey(0)] ?? [];
    if (values.length > 0) {
      content.answer = pending.questions[0]?.multiSelect ? values : values[0];
    }
  }
  return content;
}

export function createPendingElicitationSchema(pending: PendingElicitation): unknown {
  return pending.renderContext?.kind === "plan_approval"
    ? { interaction: "plan_approval", plan: pending.renderContext.plan }
    : undefined;
}

export function readStructuredElicitationResponse(value: unknown): {
  requestId: string;
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
} | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const requestId = typeof record.requestId === "string" ? record.requestId : "";
  const action = record.action;
  if (!requestId || (action !== "accept" && action !== "decline" && action !== "cancel")) {
    return null;
  }
  return {
    requestId,
    action,
    ...(record.content && typeof record.content === "object" && !Array.isArray(record.content)
      ? { content: record.content as Record<string, unknown> }
      : {}),
  };
}

export type { BotSelection };

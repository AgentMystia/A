import type { BotActor, BotInboundMessage, BotOutboundMessage, BotRuntimeState } from "@zcode/shared";
import {
  BOT_ELICITATION_BROADCAST_TIMEOUT_MS,
  BOT_ELICITATION_CUSTOM,
  BOT_ELICITATION_SUBMIT,
} from "./botsConstants.js";
import { copy } from "./botsInboundText.js";
import { createSelectionReply } from "./botsInboundDraft.js";
import type { AuthorizedContext } from "./botsInbound.js";
import { resolveZCodeTaskServiceForContext, type BotInboundTaskRuntime } from "./botsInboundRuntime.js";
import {
  buildBotElicitationContent,
  clearPendingElicitationSelection,
  createPendingElicitationSchema,
  getElicitationAnswerKey,
  getPendingElicitationSelectionToken,
  getPendingElicitationSkipOptionId,
  isPendingElicitationOwnedByActor,
  mergeElicitationFormValues,
  parseElicitationFormValues,
  parseElicitationResponseValue,
  readElicitationAnswerValues,
  resolveElicitationQuestionValue,
  toggleElicitationCustomAnswerExpanded,
  type PendingElicitation,
} from "./botsElicitationParse.js";
import type { BotMessageLocale } from "./botsCopy.js";

async function broadcastElicitationResolved(
  runtime: BotInboundTaskRuntime,
  context: BotRuntimeState,
  pending: PendingElicitation,
): Promise<void> {
  await runtime.broadcastService
    ?.send({
      channel: "bots:task-list",
      payload: {
        workspacePath: context.workspacePath,
        workspaceIdentity: context.workspaceIdentity,
        taskId: pending.taskId,
        event: "elicitation_resolved",
        requestId: pending.requestId,
        updatedAt: Date.now(),
      },
    })
    .catch(() => undefined);
}

/** 发布包 host `submitPendingElicitation`。 */
export async function submitPendingElicitation(
  runtime: BotInboundTaskRuntime,
  authorized: AuthorizedContext & { ok: true },
  actor: BotActor,
  pending: PendingElicitation,
  action: "accept" | "decline" | "cancel",
  content?: Record<string, unknown>,
): Promise<BotOutboundMessage[]> {
  if (!isPendingElicitationOwnedByActor(pending, actor)) {
    return runtime.replies(actor, copy(authorized.locale, "elicitationExpired"));
  }
  if (pending.handledAt) {
    return runtime.replies(actor, copy(authorized.locale, "elicitationHandled"));
  }
  const submitted = await (await resolveZCodeTaskServiceForContext(runtime, authorized.context)).respondElicitation({
    taskId: pending.taskId,
    workspacePath: authorized.context.workspacePath,
    workspaceIdentity: authorized.context.workspaceIdentity,
    runId: pending.runId,
    requestId: pending.requestId,
    action,
    content,
  });
  await runtime.persistContext({
    ...authorized.context,
    pendingElicitation: { ...pending, handledAt: Date.now() },
  });
  clearPendingElicitationSelection(runtime, pending);
  await runtime.persistContext({ ...authorized.context, pendingElicitation: undefined });
  await broadcastElicitationResolved(runtime, authorized.context, pending);
  if (!submitted) {
    return runtime.replies(actor, copy(authorized.locale, "elicitationHandled"));
  }
  if (action === "accept") {
    runtime.startTyping(authorized.bot, actor, pending.taskId);
  }
  return runtime.replies(
    actor,
    copy(authorized.locale, action === "accept" ? "elicitationSubmitted" : "elicitationCancelled"),
    authorized.locale,
    undefined,
    {
      elicitation: {
        requestId: pending.requestId,
        taskId: pending.taskId,
        runId: pending.runId,
        currentQuestionIndex: Math.max(0, pending.questions.length - 1),
        questions: pending.questions,
        answers: pending.answers,
        status: action === "cancel" ? "cancelled" : "completed",
        ...(createPendingElicitationSchema(pending) ? { schema: createPendingElicitationSchema(pending) } : {}),
      },
    },
  );
}

async function advancePendingElicitation(
  runtime: BotInboundTaskRuntime,
  authorized: AuthorizedContext & { ok: true },
  actor: BotActor,
  pending: PendingElicitation,
  answers: PendingElicitation["answers"],
): Promise<BotOutboundMessage[]> {
  if (pending.currentQuestionIndex >= pending.questions.length - 1) {
    return submitPendingElicitation(runtime, authorized, actor, { ...pending, answers }, "accept", buildBotElicitationContent(pending, answers));
  }
  const next: PendingElicitation = {
    ...pending,
    currentQuestionIndex: pending.currentQuestionIndex + 1,
    answers,
  };
  await runtime.persistContext({ ...authorized.context, pendingElicitation: next });
  return createElicitationReply(runtime, actor, next, authorized.locale);
}

async function createElicitationReply(
  runtime: BotInboundTaskRuntime,
  actor: BotActor,
  pending: PendingElicitation,
  locale: BotMessageLocale,
): Promise<BotOutboundMessage[]> {
  const question = pending.questions[pending.currentQuestionIndex];
  const selected = new Set(readElicitationAnswerValues(pending, pending.currentQuestionIndex));
  const options = (question?.options ?? []).map((option) => ({
    id: option.value,
    label: question?.multiSelect ? `${selected.has(option.value) ? "[x]" : "[ ]"} ${option.label}` : option.label,
    description: option.description,
  }));
  if (question?.multiSelect) {
    options.push({ id: BOT_ELICITATION_SUBMIT, label: copy(locale, "elicitationSubmitOption"), description: undefined });
  } else if (question) {
    options.push({
      id: getPendingElicitationSkipOptionId(pending),
      label: copy(locale, "elicitationSkipOption"),
      description: undefined,
    });
  }
  return createSelectionReply(runtime, actor, {
    id: `elicitation-${pending.requestId}-${pending.currentQuestionIndex}`,
    token: getPendingElicitationSelectionToken(pending),
    title: question?.question ?? copy(locale, "elicitationQuestionTitle"),
    action: "elicitation.respond",
    options,
  }, locale);
}

/** 发布包 host `handlePendingElicitationValue`。 */
export async function handlePendingElicitationValue(
  runtime: BotInboundTaskRuntime,
  authorized: AuthorizedContext & { ok: true },
  actor: BotActor,
  value: string,
): Promise<BotOutboundMessage[]> {
  const pending = authorized.context.pendingElicitation;
  if (!pending || pending.taskId !== authorized.context.activeTaskId || !isPendingElicitationOwnedByActor(pending, actor)) {
    return runtime.replies(actor, copy(authorized.locale, "elicitationExpired"));
  }
  const question = pending.questions[pending.currentQuestionIndex];
  if (!question) {
    return runtime.replies(actor, copy(authorized.locale, "elicitationExpired"));
  }
  const parsed = parseElicitationResponseValue(value);
  if (actor.provider !== "weixin") {
    const token = getPendingElicitationSelectionToken(pending);
    if (!parsed.token || parsed.token !== token) {
      return runtime.replies(actor, copy(authorized.locale, "elicitationExpired"));
    }
  }
  if (parsed.value === getPendingElicitationSkipOptionId(pending)) {
    return advancePendingElicitation(runtime, authorized, actor, pending, pending.answers);
  }
  const form = parseElicitationFormValues(parsed.value);
  if (form) {
    const merged = mergeElicitationFormValues(question, readElicitationAnswerValues(pending, pending.currentQuestionIndex), form);
    return merged.length === 0
      ? createElicitationReply(runtime, actor, pending, authorized.locale)
      : advancePendingElicitation(runtime, authorized, actor, pending, {
          ...pending.answers,
          [getElicitationAnswerKey(pending.currentQuestionIndex)]: merged,
        });
  }
  const resolved = resolveElicitationQuestionValue(question, parsed.value);
  if (resolved === BOT_ELICITATION_SUBMIT) {
    return advancePendingElicitation(runtime, authorized, actor, pending, pending.answers);
  }
  if (resolved === BOT_ELICITATION_CUSTOM) {
    const next = toggleElicitationCustomAnswerExpanded(pending);
    await runtime.persistContext({ ...authorized.context, pendingElicitation: next });
    return createElicitationReply(runtime, actor, next, authorized.locale);
  }
  const key = getElicitationAnswerKey(pending.currentQuestionIndex);
  if (question.multiSelect) {
    const current = readElicitationAnswerValues(pending, pending.currentQuestionIndex);
    const nextValues = current.includes(resolved) ? current.filter((item) => item !== resolved) : [...current, resolved];
    const next = { ...pending, answers: { ...pending.answers, [key]: nextValues } };
    await runtime.persistContext({ ...authorized.context, pendingElicitation: next });
    return createElicitationReply(runtime, actor, next, authorized.locale);
  }
  return advancePendingElicitation(runtime, authorized, actor, pending, { ...pending.answers, [key]: [resolved] });
}

/** 发布包 host `handlePendingElicitationText`。 */
export async function handlePendingElicitationText(
  runtime: BotInboundTaskRuntime,
  authorized: AuthorizedContext & { ok: true },
  actor: BotActor,
  text: string,
): Promise<BotOutboundMessage[] | null> {
  const pending = authorized.context.pendingElicitation;
  if (!pending || pending.taskId !== authorized.context.activeTaskId || !isPendingElicitationOwnedByActor(pending, actor)) {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return createElicitationReply(runtime, actor, pending, authorized.locale);
  }
  if (trimmed === getPendingElicitationSkipOptionId(pending)) {
    return advancePendingElicitation(runtime, authorized, actor, pending, pending.answers);
  }
  const question = pending.questions[pending.currentQuestionIndex];
  if (!question) {
    return runtime.replies(actor, copy(authorized.locale, "elicitationExpired"));
  }
  const values = question.multiSelect
    ? trimmed.split(/[,\n，、]/u).map((item) => item.trim()).filter(Boolean).map((item) =>
        resolveElicitationQuestionValue(question, item, { includeSubmit: false }),
      )
    : [resolveElicitationQuestionValue(question, trimmed, { includeSubmit: false })];
  return advancePendingElicitation(runtime, authorized, actor, pending, {
    ...pending.answers,
    [getElicitationAnswerKey(pending.currentQuestionIndex)]: values,
  });
}

/** 发布包 host `handleStructuredElicitationResponse`。 */
export async function handleStructuredElicitationResponse(
  runtime: BotInboundTaskRuntime,
  message: BotInboundMessage,
  response: { requestId: string; action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> },
): Promise<BotOutboundMessage[]> {
  const authorized = await runtime.withAuthorizedContext(message, "message");
  if (!authorized.ok) {
    return authorized.reply;
  }
  const pending = authorized.context.pendingElicitation;
  if (!pending || pending.requestId !== response.requestId || !isPendingElicitationOwnedByActor(pending, message.actor)) {
    return runtime.replies(message.actor, copy(authorized.locale, "elicitationExpired"));
  }
  return submitPendingElicitation(runtime, authorized, message.actor, pending, response.action, response.content);
}

export { BOT_ELICITATION_BROADCAST_TIMEOUT_MS };

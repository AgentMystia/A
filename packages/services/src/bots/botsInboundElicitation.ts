import type {
  BotActor,
  BotConfigEntry,
  BotInboundMessage,
  BotOutboundMessage,
  BotRuntimeState,
  ZCodeElicitationRequest,
} from "@zcode/shared";
import { isFeishuBotProvider, normalizeBotReplyGranularity } from "@zcode/shared";
import {
  BOT_ELICITATION_BROADCAST_TIMEOUT_MS,
  BOT_ELICITATION_CUSTOM,
  BOT_ELICITATION_SUBMIT,
} from "./botsConstants.js";
import { copy, getActorContextKey } from "./botsInboundText.js";
import { createSelectionReply } from "./botsInboundDraft.js";
import type { AuthorizedContext } from "./botsInbound.js";
import {
  resolveZCodeTaskServiceForContext,
  type BotInboundTaskRuntime,
} from "./botsInboundRuntime.js";
import {
  createBotElicitationRequestSnapshot,
  createBotElicitationSelection,
  createCompletedElicitationOutbound,
  normalizeBotElicitationQuestions,
  readBotElicitationRenderContext,
} from "./botsElicitationBuild.js";
import {
  buildBotElicitationContent,
  clearPendingElicitationSelection,
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
import { broadcastTaskListChange } from "./botsBroadcast.js";
import { createOutbound } from "./botsOutbound.js";
import { upsertTransientInteractionCard } from "./botsTransientCards.js";

async function broadcastElicitationResolved(
  runtime: BotInboundTaskRuntime,
  context: BotRuntimeState,
  pending: PendingElicitation,
): Promise<void> {
  await broadcastTaskListChange(runtime, context, pending.taskId, "elicitation_resolved", {
    requestId: pending.requestId,
  });
}

/** 发布包 host `clearPendingElicitationForRequest`。 */
export async function clearPendingElicitationForRequest(
  runtime: BotInboundTaskRuntime,
  context: BotRuntimeState,
  requestId: string,
): Promise<void> {
  if (context.pendingElicitation?.requestId !== requestId) {
    return;
  }
  clearPendingElicitationSelection(runtime, context.pendingElicitation);
  await runtime.persistContext({ ...context, pendingElicitation: undefined });
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
  const submitted = await (
    await resolveZCodeTaskServiceForContext(runtime, authorized.context)
  ).respondElicitation({
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
  return createCompletedElicitationOutbound(
    runtime.replies,
    actor,
    pending,
    authorized.locale,
    action,
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
    return submitPendingElicitation(
      runtime,
      authorized,
      actor,
      { ...pending, answers },
      "accept",
      buildBotElicitationContent(pending, answers),
    );
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
  return createSelectionReply(
    runtime,
    actor,
    createBotElicitationSelection(pending, locale),
    locale,
  );
}

/** 发布包 host `handlePendingElicitationValue`。 */
export async function handlePendingElicitationValue(
  runtime: BotInboundTaskRuntime,
  authorized: AuthorizedContext & { ok: true },
  actor: BotActor,
  value: string,
): Promise<BotOutboundMessage[]> {
  const pending = authorized.context.pendingElicitation;
  if (
    !pending ||
    pending.taskId !== authorized.context.activeTaskId ||
    !isPendingElicitationOwnedByActor(pending, actor)
  ) {
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
    const merged = mergeElicitationFormValues(
      question,
      readElicitationAnswerValues(pending, pending.currentQuestionIndex),
      form,
    );
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
    const nextValues = current.includes(resolved)
      ? current.filter((item) => item !== resolved)
      : [...current, resolved];
    const next = { ...pending, answers: { ...pending.answers, [key]: nextValues } };
    await runtime.persistContext({ ...authorized.context, pendingElicitation: next });
    return createElicitationReply(runtime, actor, next, authorized.locale);
  }
  return advancePendingElicitation(runtime, authorized, actor, pending, {
    ...pending.answers,
    [key]: [resolved],
  });
}

/** 发布包 host `handlePendingElicitationText`。 */
export async function handlePendingElicitationText(
  runtime: BotInboundTaskRuntime,
  authorized: AuthorizedContext & { ok: true },
  actor: BotActor,
  text: string,
): Promise<BotOutboundMessage[] | null> {
  const pending = authorized.context.pendingElicitation;
  if (
    !pending ||
    pending.taskId !== authorized.context.activeTaskId ||
    !isPendingElicitationOwnedByActor(pending, actor)
  ) {
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
    ? trimmed
        .split(/[,\n，、]/u)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => resolveElicitationQuestionValue(question, item, { includeSubmit: false }))
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
  response: {
    requestId: string;
    action: "accept" | "decline" | "cancel";
    content?: Record<string, unknown>;
  },
): Promise<BotOutboundMessage[]> {
  const authorized = await runtime.withAuthorizedContext(message, "message");
  if (!authorized.ok) {
    return authorized.reply;
  }
  const pending = authorized.context.pendingElicitation;
  if (
    !pending ||
    pending.requestId !== response.requestId ||
    !isPendingElicitationOwnedByActor(pending, message.actor)
  ) {
    return runtime.replies(message.actor, copy(authorized.locale, "elicitationExpired"));
  }
  return submitPendingElicitation(
    runtime,
    authorized,
    message.actor,
    pending,
    response.action,
    response.content,
  );
}

/** 发布包 host `broadcastPendingElicitationProgress`。 */
export async function broadcastPendingElicitationProgress(
  runtime: BotInboundTaskRuntime,
  context: BotRuntimeState,
  pending: PendingElicitation,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    broadcastTaskListChange(runtime, context, pending.taskId, "elicitation_request", {
      elicitationRequest: createBotElicitationRequestSnapshot(pending),
      requestId: pending.requestId,
    }).then(() => "broadcast" as const),
    new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), BOT_ELICITATION_BROADCAST_TIMEOUT_MS);
    }),
  ]);
  if (timer) {
    clearTimeout(timer);
  }
  if (result === "timeout") {
    runtime.logger.warn(
      undefined,
      `elicitation progress broadcast timed out task=${pending.taskId} request=${pending.requestId}`,
    );
  }
}

/** 发布包 host `shouldUseTransientInteractionCard`。 */
export function shouldUseTransientInteractionCard(
  runtime: BotInboundTaskRuntime,
  bot: BotConfigEntry,
): boolean {
  const provider = runtime.providers[bot.provider];
  return (
    isFeishuBotProvider(bot.provider) &&
    normalizeBotReplyGranularity(bot.provider, bot.replyMode) === "streaming_card" &&
    !!provider?.createTransientInteractionCard &&
    !!provider?.updateTransientInteractionCard
  );
}

/** 发布包 host `handleElicitationRequest`。 */
export async function handleElicitationRequest(
  runtime: BotInboundTaskRuntime,
  bot: BotConfigEntry,
  actor: BotActor,
  context: BotRuntimeState,
  request: ZCodeElicitationRequest,
): Promise<void> {
  const locale = await runtime.readMessageLocale();
  runtime.stopTyping(request.taskId);
  const pending: PendingElicitation = {
    taskId: request.taskId,
    requestId: request.requestId,
    runId: request.traceId,
    ...(request.origin ? { origin: request.origin } : {}),
    actorKey: getActorContextKey(actor),
    currentQuestionIndex: 0,
    questions: normalizeBotElicitationQuestions(request, locale),
    answers: {},
    ...(readBotElicitationRenderContext(request)
      ? { renderContext: readBotElicitationRenderContext(request) }
      : {}),
  };
  if (context.pendingElicitation) {
    clearPendingElicitationSelection(runtime, context.pendingElicitation);
  }
  Object.assign(context, { pendingElicitation: pending });
  await runtime.persistContext({ ...context, pendingElicitation: pending });
  await broadcastPendingElicitationProgress(runtime, context, pending);
  const replies = await createElicitationReply(runtime, actor, pending, locale);
  for (const reply of replies) {
    const outbound = createOutbound(actor, reply.text, reply.selection, {
      locale,
      elicitation: reply.elicitation,
    });
    if (shouldUseTransientInteractionCard(runtime, bot)) {
      await upsertTransientInteractionCard(
        runtime.providers,
        runtime.transientCards,
        bot,
        actor,
        request.taskId,
        outbound,
      );
      continue;
    }
    await runtime.sendOutbound(bot, outbound);
  }
}

export { BOT_ELICITATION_BROADCAST_TIMEOUT_MS };

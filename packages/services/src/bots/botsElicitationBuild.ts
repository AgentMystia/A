import type {
  BotActor,
  BotOutboundMessage,
  BotProviderOutbound,
  ZCodeElicitationRequest,
} from "@zcode/shared";
import {
  BOT_ELICITATION_CUSTOM,
  BOT_ELICITATION_SKIP,
  BOT_ELICITATION_SUBMIT,
} from "./botsConstants.js";
import type { BotMessageLocale } from "./botsCopy.js";
import { copy } from "./botsInboundText.js";
import {
  createPendingElicitationSchema,
  getPendingElicitationSelectionToken,
  getPendingElicitationSkipOptionId,
  readElicitationAnswerValues,
  type PendingElicitation,
} from "./botsElicitationParse.js";
import { isRecord } from "./botsNormalize.js";
import type { BotSelection } from "./botsTypes.js";

/** 发布包 host `normalizeBotElicitationQuestions`。 */
export function normalizeBotElicitationQuestions(
  request: ZCodeElicitationRequest,
  locale: BotMessageLocale,
): PendingElicitation["questions"] {
  const schema = isRecord(request.schema) ? request.schema : null;
  if (schema?.interaction === "plan_approval") {
    return [
      {
        question: copy(locale, "planApprovalTitle"),
        header: copy(locale, "planApprovalHeader"),
        options: [
          {
            value: "approve",
            label: copy(locale, "planApprovalApprove"),
            description: copy(locale, "planApprovalApproveDescription"),
          },
        ],
      },
    ];
  }
  const questions =
    request.questions && request.questions.length > 0
      ? request.questions
      : [
          {
            question: request.message,
            header: request.header ?? request.message,
            options: request.options,
            ...(request.multiSelect ? { multiSelect: true } : {}),
          },
        ];
  return questions.map((question) => ({
    question: question.question,
    header: question.header || question.question,
    options: question.options.map((option) => ({
      value: option.value,
      label: option.label || option.value,
      description: option.description,
    })),
    ...(question.multiSelect ? { multiSelect: true } : {}),
  }));
}

/** 发布包 host `readBotElicitationRenderContext`。 */
export function readBotElicitationRenderContext(
  request: ZCodeElicitationRequest,
): PendingElicitation["renderContext"] {
  const schema = isRecord(request.schema) ? request.schema : null;
  if (schema?.interaction !== "plan_approval" || typeof schema.plan !== "string" || !schema.plan.trim()) {
    return undefined;
  }
  return { kind: "plan_approval", plan: schema.plan.trim() };
}

/** 发布包 host `formatBotElicitationTitle`。 */
export function formatBotElicitationTitle(pending: PendingElicitation, locale: BotMessageLocale): string {
  const question = pending.questions[pending.currentQuestionIndex];
  if (!question) {
    return pending.requestId;
  }
  const expanded = pending.expandedCustomAnswerQuestionIndexes?.includes(pending.currentQuestionIndex) === true;
  if (pending.renderContext?.kind === "plan_approval") {
    return [pending.renderContext.plan, "------", copy(locale, "planApprovalTitle"), expanded ? copy(locale, "elicitationCustomPlaceholder") : null]
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .join("\n\n");
  }
  return [
    pending.questions.length > 1 ? `${pending.currentQuestionIndex + 1}/${pending.questions.length}` : null,
    question.header && question.header !== question.question ? question.header : null,
    question.question,
    question.multiSelect ? copy(locale, "elicitationMultiSelectHint") : null,
    expanded ? copy(locale, "elicitationCustomPlaceholder") : null,
    copy(locale, "elicitationTextHint"),
  ]
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .join("\n");
}

/** 发布包 host `createBotElicitationSelection`。 */
export function createBotElicitationSelection(
  pending: PendingElicitation,
  locale: BotMessageLocale,
): BotSelection {
  const question = pending.questions[pending.currentQuestionIndex];
  const selected = new Set(readElicitationAnswerValues(pending, pending.currentQuestionIndex));
  const options: BotSelection["options"] =
    question?.options.map((option) => ({
      id: option.value,
      label: question.multiSelect ? `${selected.has(option.value) ? "[x]" : "[ ]"} ${option.label}` : option.label,
      description: pending.renderContext?.kind === "plan_approval" ? undefined : option.description,
    })) ?? [];
  if (pending.renderContext?.kind === "plan_approval") {
    options.push({ id: BOT_ELICITATION_CUSTOM, label: copy(locale, "elicitationCustomOption") });
  }
  if (question?.multiSelect) {
    options.push({ id: BOT_ELICITATION_SUBMIT, label: copy(locale, "elicitationSubmitOption") });
  } else if (question) {
    options.push({
      id: getPendingElicitationSkipOptionId(pending),
      label: copy(locale, "elicitationSkipOption"),
    });
  }
  return {
    id: `elicitation-${pending.requestId}-${pending.currentQuestionIndex}`,
    token: getPendingElicitationSelectionToken(pending),
    title: formatBotElicitationTitle(pending, locale),
    action: "elicitation.respond",
    options,
  };
}

/** 发布包 host `createBotElicitationRequestSnapshot`。 */
export function createBotElicitationRequestSnapshot(pending: PendingElicitation): ZCodeElicitationRequest {
  const question = pending.questions[pending.currentQuestionIndex] ?? pending.questions[0];
  const answerDrafts = Object.fromEntries(
    Object.entries(pending.answers).map(([key, values]) => [`answer_${key}`, values]),
  );
  const schema = createPendingElicitationSchema(pending);
  return {
    type: "elicitation_request",
    taskId: pending.taskId,
    traceId: pending.runId as ZCodeElicitationRequest["traceId"],
    requestId: pending.requestId,
    ...(pending.origin ? { origin: pending.origin as ZCodeElicitationRequest["origin"] } : {}),
    message: question?.question ?? "",
    header: question?.header,
    options: question?.options ?? [],
    ...(question?.multiSelect ? { multiSelect: true } : {}),
    questions: pending.questions,
    currentQuestionIndex: pending.currentQuestionIndex,
    answerDrafts,
    ...(schema ? { schema } : {}),
  };
}

/** 发布包 host `createCompletedElicitationOutbound`。 */
export function createCompletedElicitationOutbound(
  replies: (
    actor: BotActor,
    text: string,
    locale?: BotMessageLocale,
    selection?: BotSelection,
    extra?: Partial<BotProviderOutbound>,
  ) => BotOutboundMessage[],
  actor: BotActor,
  pending: PendingElicitation,
  locale: BotMessageLocale,
  action: "accept" | "decline" | "cancel",
): BotOutboundMessage[] {
  const schema = createPendingElicitationSchema(pending);
  return replies(
    actor,
    copy(locale, action === "accept" ? "elicitationSubmitted" : "elicitationCancelled"),
    locale,
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
        ...(schema ? { schema } : {}),
      },
    },
  );
}


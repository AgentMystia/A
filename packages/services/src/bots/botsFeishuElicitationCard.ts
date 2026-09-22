import type { BotProviderOutbound } from "@zcode/shared";
import { BOT_ELICITATION_CUSTOM, BOT_ELICITATION_FORM_PREFIX } from "./botsConstants.js";
import { formatBotMessage } from "./botsCopy.js";
import {
  buildFeishuButtonElement,
  buildFeishuInteractiveCardPayload,
  formatFeishuCardMarkdownContent,
} from "./botsFeishuCards.js";
import { isRecord } from "./botsJson.js";
import type { BotSelection } from "./botsTypes.js";

interface FeishuElicitationOption {
  value: string;
  label: string;
  description?: string;
}

interface FeishuElicitationQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: FeishuElicitationOption[];
}

interface FeishuElicitationCardState {
  questions: FeishuElicitationQuestion[];
  currentQuestionIndex: number;
  answers?: Record<string, string[]>;
  status?: string;
  expandedCustomAnswerQuestionIndexes?: number[];
  schema?: unknown;
}

interface FeishuElicitationCardMessage {
  text: string;
  locale?: BotProviderOutbound["locale"];
  selection?: BotSelection;
  elicitation?: FeishuElicitationCardState;
}

function readCardElicitation(value: unknown): FeishuElicitationCardState | null {
  if (!isRecord(value) || !Array.isArray(value.questions)) {
    return null;
  }
  const questions = value.questions.filter(isElicitationQuestion);
  if (questions.length !== value.questions.length) {
    return null;
  }
  const currentQuestionIndex =
    typeof value.currentQuestionIndex === "number" ? value.currentQuestionIndex : 0;
  return {
    questions,
    currentQuestionIndex,
    ...(isRecord(value.answers) ? { answers: readAnswerMap(value.answers) } : {}),
    ...(typeof value.status === "string" ? { status: value.status } : {}),
    ...(Array.isArray(value.expandedCustomAnswerQuestionIndexes)
      ? {
          expandedCustomAnswerQuestionIndexes: value.expandedCustomAnswerQuestionIndexes.filter(
            (item): item is number => typeof item === "number",
          ),
        }
      : {}),
    ...(value.schema !== undefined ? { schema: value.schema } : {}),
  };
}

function isElicitationQuestion(value: unknown): value is FeishuElicitationQuestion {
  if (!isRecord(value) || typeof value.question !== "string" || !Array.isArray(value.options)) {
    return false;
  }
  return value.options.every(
    (option) =>
      isRecord(option) && typeof option.value === "string" && typeof option.label === "string",
  );
}

function readAnswerMap(value: Record<string, unknown>): Record<string, string[]> {
  const answers: Record<string, string[]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) {
      answers[key] = item;
    }
  }
  return answers;
}

function readCardAnswerValues(message: FeishuElicitationCardMessage, index: number): string[] {
  return message.elicitation?.answers?.[String(index)] ?? [];
}

/** 发布包 host `formatFeishuPlainText`。 */
export function formatFeishuPlainText(content: string): Record<string, unknown> {
  return { tag: "plain_text", content };
}

/** 发布包 host `readPlanApprovalContent`。 */
export function readPlanApprovalContent(message: FeishuElicitationCardMessage): string | null {
  const schema = message.elicitation?.schema;
  if (!isRecord(schema) || schema.interaction !== "plan_approval") {
    return null;
  }
  return typeof schema.plan === "string" && schema.plan.trim() ? schema.plan.trim() : null;
}

/** 发布包 host `formatElicitationAnswerLabel`。 */
export function formatElicitationAnswerLabel(
  message: FeishuElicitationCardMessage,
  index: number,
): string {
  const question = message.elicitation?.questions[index];
  const values = readCardAnswerValues(message, index);
  if (!question || values.length === 0) {
    return "";
  }
  return values
    .map((value) => question.options.find((option) => option.value === value)?.label ?? value)
    .join(", ");
}

/** 发布包 host `isFeishuElicitationCustomExpanded`。 */
export function isFeishuElicitationCustomExpanded(
  message: FeishuElicitationCardMessage,
  index: number,
): boolean {
  return message.elicitation?.expandedCustomAnswerQuestionIndexes?.includes(index) ?? false;
}

/** 发布包 host `readFeishuElicitationCustomValues`。 */
export function readFeishuElicitationCustomValues(
  message: FeishuElicitationCardMessage,
  question: FeishuElicitationQuestion,
  index: number,
): string[] {
  const known = new Set(question.options.map((option) => option.value));
  return readCardAnswerValues(message, index).filter((value) => !known.has(value));
}

/** 发布包 host `buildFeishuElicitationOptionCommand`。 */
export function buildFeishuElicitationOptionCommand(
  message: FeishuElicitationCardMessage,
  optionValue: string,
): string {
  const token = message.selection?.token;
  return token ? `/elicitation ${token} ${optionValue}` : optionValue;
}

/** 发布包 host `buildFeishuElicitationFormCommand`。 */
export function buildFeishuElicitationFormCommand(token: string, value?: unknown): string {
  const encoded =
    value === undefined
      ? BOT_ELICITATION_FORM_PREFIX
      : `${BOT_ELICITATION_FORM_PREFIX}${encodeURIComponent(JSON.stringify(value))}`;
  return `/elicitation ${token} ${encoded}`;
}

/** 发布包 host `buildFeishuElicitationChoiceButton`。 */
export function buildFeishuElicitationChoiceButton(input: {
  message: FeishuElicitationCardMessage;
  question: FeishuElicitationQuestion;
  option: FeishuElicitationOption;
  selectedValues: readonly string[];
}): Record<string, unknown> {
  const selected = input.selectedValues.includes(input.option.value);
  const mark = input.question.multiSelect
    ? selected
      ? "\u2611"
      : "\u2610"
    : selected
      ? "\u25CF"
      : "\u25CB";
  return buildFeishuButtonElement({
    text: `${mark} ${input.option.label}`,
    type: selected ? "primary" : "default",
    command: buildFeishuElicitationOptionCommand(input.message, input.option.value),
    originalText: input.message.text,
  });
}

/** 发布包 host `buildFeishuElicitationCustomButton`。 */
export function buildFeishuElicitationCustomButton(
  message: FeishuElicitationCardMessage,
  question: FeishuElicitationQuestion,
  index: number,
): Record<string, unknown> {
  const customValues = readFeishuElicitationCustomValues(message, question, index);
  const active = isFeishuElicitationCustomExpanded(message, index) || customValues.length > 0;
  const mark = question.multiSelect ? (active ? "\u2611" : "\u2610") : active ? "\u25CF" : "\u25CB";
  return buildFeishuButtonElement({
    text: `${mark} ${formatBotMessage(message.locale, "elicitationCustomOption")}`,
    type: active ? "primary" : "default",
    command: buildFeishuElicitationOptionCommand(message, BOT_ELICITATION_CUSTOM),
    originalText: message.text,
  });
}

/** 发布包 host `buildFeishuElicitationForm`。 */
export function buildFeishuElicitationForm(
  message: FeishuElicitationCardMessage,
  question: FeishuElicitationQuestion,
  index: number,
): Record<string, unknown> | null {
  const selection = message.selection;
  if (!selection?.token) {
    return null;
  }
  const expanded = isFeishuElicitationCustomExpanded(message, index);
  const showInput = question.options.length === 0 || expanded;
  if (!(question.multiSelect || showInput)) {
    return null;
  }
  const customValues = readFeishuElicitationCustomValues(message, question, index);
  const elements: unknown[] = [];
  if (showInput) {
    elements.push({
      tag: "input",
      name: "answer",
      required: question.options.length === 0,
      width: "fill",
      input_type: "multiline_text",
      rows: 2,
      auto_resize: true,
      max_rows: 5,
      placeholder: formatFeishuPlainText(
        formatBotMessage(message.locale, "elicitationCustomPlaceholder"),
      ),
      default_value: customValues.join(", "),
    });
  }
  elements.push({
    tag: "button",
    text: formatFeishuPlainText(formatBotMessage(message.locale, "elicitationSubmitOption")),
    type: "primary",
    form_action_type: "submit",
    name: "submit",
    behaviors: [
      {
        type: "callback",
        value: {
          command: buildFeishuElicitationFormCommand(selection.token),
          zcodeCardText: message.text,
        },
      },
    ],
  });
  return {
    tag: "form",
    name: `elicitation_form_${index}`,
    direction: "vertical",
    vertical_spacing: "8px",
    elements,
  };
}

/** 发布包 host `buildFeishuElicitationAnswerElements`。 */
export function buildFeishuElicitationAnswerElements(
  message: FeishuElicitationCardMessage,
): unknown[] {
  const elicitation = message.elicitation;
  if (!elicitation) {
    return [];
  }
  const settled = elicitation.status === "completed" || elicitation.status === "cancelled";
  const elements: unknown[] = [];
  elicitation.questions.forEach((question, index) => {
    if (!settled && index >= elicitation.currentQuestionIndex) {
      return;
    }
    const label = formatElicitationAnswerLabel(message, index);
    if (!label) {
      return;
    }
    elements.push(
      {
        tag: "markdown",
        content: formatFeishuCardMarkdownContent(
          `#### ${index + 1}/${elicitation.questions.length} ${question.question}`,
        ),
      },
      { tag: "markdown", content: formatFeishuCardMarkdownContent(label) },
    );
  });
  return elements;
}

/** 发布包 host `buildFeishuElicitationCardPayload`。 */
export function buildFeishuElicitationCardPayload(
  outbound: BotProviderOutbound,
): Record<string, unknown> {
  const elicitation = readCardElicitation(outbound.elicitation);
  const message: FeishuElicitationCardMessage = {
    text: outbound.text,
    locale: outbound.locale,
    selection: isSelection(outbound.selection) ? outbound.selection : undefined,
    ...(elicitation ? { elicitation } : {}),
  };
  if (!elicitation) {
    return buildFeishuInteractiveCardPayload(outbound);
  }
  const question =
    elicitation.questions[elicitation.currentQuestionIndex] ?? elicitation.questions[0];
  const settled = elicitation.status === "completed" || elicitation.status === "cancelled";
  const answers = buildFeishuElicitationAnswerElements(message);
  const plan = readPlanApprovalContent(message);
  const elements: unknown[] = [];
  if (settled && plan) {
    elements.push({ tag: "markdown", content: formatFeishuCardMarkdownContent(plan) });
    if (answers.length > 0) {
      elements.push({ tag: "hr" });
    }
  }
  elements.push(...answers);
  if (!settled && question) {
    if (answers.length > 0) {
      elements.push({ tag: "hr" });
    }
    if (!plan) {
      elements.push({
        tag: "markdown",
        content: formatFeishuCardMarkdownContent(
          `#### ${formatBotMessage(message.locale, "elicitationQuestionTitle")}`,
        ),
      });
    }
    const lines = plan
      ? [plan]
      : [
          question.header && question.header !== question.question
            ? `**${question.header}**`
            : null,
          question.question,
        ];
    elements.push({
      tag: "markdown",
      content: formatFeishuCardMarkdownContent(
        lines
          .filter((line): line is string => typeof line === "string" && line.length > 0)
          .join("\n\n"),
      ),
    });
    if (plan) {
      elements.push(
        { tag: "hr" },
        {
          tag: "markdown",
          content: formatFeishuCardMarkdownContent(
            `**${formatBotMessage(message.locale, "planApprovalTitle")}**`,
          ),
        },
      );
    }
    const selected = readCardAnswerValues(message, elicitation.currentQuestionIndex);
    for (const option of question.options) {
      const displayed = plan
        ? {
            ...option,
            label: formatBotMessage(message.locale, "planApprovalApprove"),
            description: formatBotMessage(message.locale, "planApprovalApproveDescription"),
          }
        : option;
      elements.push(
        buildFeishuElicitationChoiceButton({
          message,
          question,
          option: displayed,
          selectedValues: selected,
        }),
      );
    }
    elements.push(
      buildFeishuElicitationCustomButton(message, question, elicitation.currentQuestionIndex),
    );
    const form = buildFeishuElicitationForm(message, question, elicitation.currentQuestionIndex);
    if (form) {
      elements.push(form);
    }
    const showCancel =
      question.multiSelect ||
      question.options.length === 0 ||
      isFeishuElicitationCustomExpanded(message, elicitation.currentQuestionIndex);
    if (message.selection && showCancel && message.selection.showCancel !== false) {
      const expanded = isFeishuElicitationCustomExpanded(message, elicitation.currentQuestionIndex);
      elements.push(
        buildFeishuButtonElement({
          text:
            message.selection.cancelLabel ??
            formatBotMessage(message.locale, "selectionCancelOption"),
          type: "default",
          command:
            expanded && question.options.length > 0
              ? buildFeishuElicitationOptionCommand(message, BOT_ELICITATION_CUSTOM)
              : "/cancel",
          originalText: message.text,
        }),
      );
    }
  } else if (elicitation.status === "cancelled") {
    elements.push({
      tag: "markdown",
      content: formatFeishuCardMarkdownContent(
        formatBotMessage(message.locale, "elicitationCancelledCard"),
      ),
    });
  }
  return { schema: "2.0", config: { wide_screen_mode: true }, body: { elements } };
}

function isSelection(value: unknown): value is BotSelection {
  return isRecord(value) && typeof value.action === "string" && Array.isArray(value.options);
}

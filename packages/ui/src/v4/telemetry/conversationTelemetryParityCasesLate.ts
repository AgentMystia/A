import {
  buildStandardParitySequence,
  defineParityCase,
  type ConversationTelemetryParityCase,
  type ParityOperation,
} from "@/v4/telemetry/conversationTelemetryParityModel.js";

function buildTdp18Operations(): ParityOperation[] {
  const operations = buildStandardParitySequence({ caseId: "TDP18", includeNetwork: true });
  const chunk = operations.find((operation) => operation.kind === "chunk");
  const terminal = operations.find((operation) => operation.kind === "terminal");
  if (chunk) operations.push({ ...chunk });
  if (terminal) operations.push({ ...terminal, duplicate: true });
  operations.push({ kind: "scope.dispose" });
  return operations;
}

function buildTdp19Operations(): ParityOperation[] {
  return [
    ...buildStandardParitySequence({ caseId: "TDP19A", scope: "identity-a" }),
    ...buildStandardParitySequence({ caseId: "TDP19B", scope: "identity-b" }),
    { kind: "scope.dispose", scope: "identity-a" },
    {
      kind: "web.noop",
      operations: buildStandardParitySequence({ caseId: "TDP19WEB", scope: "web" }),
    },
  ];
}

const visibleErrors: ParityOperation[] = [
  {
    kind: "visible.error",
    errorKey: "tdp14-key-1",
    displayMessage: "Visible provider failure",
    code: "PROVIDER_ERROR",
    traceId: "tdp14-trace-1",
    sessionId: "tdp14-session",
    detail: "bounded detail",
  },
  {
    kind: "visible.error",
    errorKey: "tdp14-key-1",
    displayMessage: "Visible provider failure",
    code: "PROVIDER_ERROR",
    traceId: "tdp14-trace-1",
    sessionId: "tdp14-session",
    duplicate: true,
  },
  {
    kind: "visible.error",
    errorKey: "tdp14-suppressed",
    displayMessage: "Suppressed local error",
    code: "LOCAL_ERROR",
    traceId: "tdp14-trace-suppressed",
    sessionId: "tdp14-session",
    suppressed: true,
  },
  {
    kind: "visible.error",
    errorKey: "tdp14-key-2",
    displayMessage: "Second visible provider failure",
    code: "SECOND_ERROR",
    traceId: "tdp14-trace-2",
    sessionId: "tdp14-session",
  },
];

const feedback: ParityOperation[] = [
  {
    kind: "feedback",
    sessionId: "tdp15-session",
    messageId: "tdp15-assistant",
    reaction: "like",
  },
  {
    kind: "feedback",
    sessionId: "tdp15-session",
    messageId: "tdp15-assistant",
    reaction: "dislike",
  },
  {
    kind: "feedback",
    sessionId: "tdp15-session",
    messageId: "tdp15-assistant",
    reaction: "none",
  },
];

export function buildLateConversationTelemetryParityCases(): ConversationTelemetryParityCase[] {
  return [
    defineParityCase("TDP14", visibleErrors, {}, { chat_error_banner: 2 }, [
      "visible",
      "suppressed-zero",
      "same-key-once",
      "new-key-new-event",
    ]),
    defineParityCase("TDP15", feedback, { assistant_message_feedback: 3 }, {}, [
      "like",
      "dislike",
      "toggle-none",
      "command-failure-rollback",
      "reopen-persisted",
    ]),
    defineParityCase("TDP16", [{ kind: "quota.assert" }], {}, {}, [
      "quota-banner",
      "dismiss",
      "blocking-and-nonblocking",
      "entitlement-refresh",
      "upgrade-context",
      "purchase-events-pruned",
    ]),
    defineParityCase(
      "TDP17",
      [
        { kind: "captcha.assert" },
        {
          kind: "visible.error",
          errorKey: "tdp17-3007",
          displayMessage: "Captcha verification failed. Please try again.",
          code: "3007",
          traceId: "tdp17-trace",
          sessionId: "tdp17-session",
        },
      ],
      {},
      { chat_error_banner: 1 },
      [
        "visible-3007",
        "exact-zcode-plan-provider",
        "one-shot-header",
        "accepted-duplicate-handled",
        "failure-retryable",
        "non-zcode-plan-skipped",
      ],
    ),
    defineParityCase(
      "TDP18",
      buildTdp18Operations(),
      { send_btn: 1, agent_step: 1, message_completion: 1 },
      {
        plan_request: 2,
        plan_ttft: 1,
        perf_ui_first_token: 1,
        perf_ui_message_complete: 1,
        perf_ui_turn_breakdown: 1,
      },
      ["duplicate-live-once", "initial-hydration-recovery-zero", "reload-zero-replay"],
    ),
    defineParityCase(
      "TDP19",
      buildTdp19Operations(),
      { send_btn: 2, agent_step: 2, message_completion: 2 },
      {
        plan_request: 4,
        plan_ttft: 2,
        perf_ui_first_token: 2,
        perf_ui_message_complete: 2,
        perf_ui_turn_breakdown: 2,
      },
      ["workspace-identity-isolated", "remote-session-isolated", "generation-disposed", "web-noop"],
    ),
  ];
}

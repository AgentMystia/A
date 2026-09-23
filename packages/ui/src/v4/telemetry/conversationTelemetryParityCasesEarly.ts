import {
  PARITY_PROMPT_SEED,
  buildStandardParitySequence,
  defineParityCase,
  type ConversationTelemetryParityCase,
  type ParityOperation,
} from "@/v4/telemetry/conversationTelemetryParityModel.js";
import { buildTdp08Operations } from "@/v4/telemetry/conversationTelemetryParityTdp08.js";

function buildTdp03Operations(): ParityOperation[] {
  const first = buildStandardParitySequence({
    caseId: "TDP03A",
    sessionId: "tdp03-session",
    commandId: "tdp03-command-1",
    terminalAt: 500,
  });
  const second = buildStandardParitySequence({
    caseId: "TDP03B",
    sessionId: "tdp03-session",
    commandId: "tdp03-command-2",
    sendAt: 150,
    chunkAt: 600,
    terminalAt: 700,
  });
  return [
    ...first.slice(0, 7),
    ...second.slice(0, 4),
    ...first.slice(7),
    {
      kind: "seed",
      sessionId: "tdp03-session",
      commandId: "tdp03-command-2",
      now: 550,
      duplicate: true,
      ...PARITY_PROMPT_SEED,
    },
    ...second.slice(4),
  ];
}

function buildTdp05Operations(): ParityOperation[] {
  const operations: ParityOperation[] = [];
  for (const [index, includeUsage] of [true, false].entries()) {
    const suffix = String(index + 1);
    const sessionId = `tdp05-session-${suffix}`;
    const commandId = `tdp05-command-${suffix}`;
    const turnId = `tdp05-turn-${suffix}`;
    const failed = index === 0;
    operations.push(
      { kind: "foreground.attach", sessionId, owner: `tdp05-owner-${suffix}` },
      {
        kind: "seed",
        sessionId,
        commandId,
        now: 100 + index * 400,
        ...PARITY_PROMPT_SEED,
      },
      {
        kind: "turn.started",
        now: 110 + index * 400,
        eventId: `tdp05-start-${suffix}`,
        sessionId,
        commandId,
        turnId,
      },
      {
        kind: "model.status",
        now: 120 + index * 400,
        eventId: `tdp05-request-start-${suffix}`,
        sessionId,
        commandId,
        turnId,
        requestId: `tdp05-request-${suffix}`,
        status: "model_request_started",
        providerId: "glm",
        modelId: "glm-model",
      },
      {
        kind: "chunk",
        now: 150 + index * 400,
        eventId: `tdp05-chunk-${suffix}`,
        sessionId,
        commandId,
        turnId,
        channel: "text",
        firstChunk: true,
      },
      ...(includeUsage
        ? [
            {
              kind: "usage",
              now: 170,
              eventId: "tdp05-usage-1",
              sessionId,
              commandId,
              turnId,
              inputTokens: 9,
              outputTokens: 3,
            } satisfies ParityOperation,
          ]
        : []),
      {
        kind: "model.status",
        now: 180 + index * 400,
        eventId: `tdp05-request-fail-${suffix}`,
        sessionId,
        commandId,
        turnId,
        requestId: `tdp05-request-${suffix}`,
        status: "model_request_failed",
        providerId: "glm",
        modelId: "glm-model",
        ...(failed ? { reason: "provider failed" } : {}),
        statusCode: 500,
      },
      {
        kind: "terminal",
        now: 200 + index * 400,
        eventId: `tdp05-terminal-${suffix}`,
        sessionId,
        commandId,
        turnId,
        status: "failed",
        ...(failed ? { errorCode: "PROVIDER_ERROR", errorMessage: "provider failed" } : {}),
      },
    );
  }
  return operations;
}

function buildTdp06Operations(): ParityOperation[] {
  return [
    ...buildStandardParitySequence({ caseId: "TDP06A", includeNetwork: false }).map((operation) =>
      operation.kind === "terminal"
        ? { ...operation, status: "interrupted", errorCode: "USER_INTERRUPT" }
        : operation,
    ),
    {
      kind: "foreground.attach",
      sessionId: "tdp06-no-terminal",
      owner: "tdp06-owner-2",
    },
    {
      kind: "seed",
      sessionId: "tdp06-no-terminal",
      commandId: "tdp06-no-terminal-command",
      now: 500,
      ...PARITY_PROMPT_SEED,
    },
    {
      kind: "turn.started",
      now: 510,
      eventId: "tdp06-no-terminal-start",
      sessionId: "tdp06-no-terminal",
      commandId: "tdp06-no-terminal-command",
      turnId: "tdp06-no-terminal-turn",
    },
  ];
}

function buildTdp07Operations(): ParityOperation[] {
  const operations = buildStandardParitySequence({ caseId: "TDP07", includeNetwork: false });
  const chunkIndex = operations.findIndex((operation) => operation.kind === "chunk");
  operations.splice(chunkIndex, 0, {
    kind: "chunk",
    now: 150,
    eventId: "tdp07-thought",
    sessionId: "tdp07-session",
    commandId: "tdp07-command",
    turnId: "tdp07-turn",
    channel: "thought",
    firstChunk: true,
  });
  return operations;
}

const reportOnce = { send_btn: 1, agent_step: 1, message_completion: 1 };
const armsOnce = {
  plan_request: 2,
  plan_ttft: 1,
  perf_ui_first_token: 1,
  perf_ui_message_complete: 1,
  perf_ui_turn_breakdown: 1,
};
const reportTwice = { send_btn: 2, agent_step: 2, message_completion: 2 };
const armsTwice = {
  plan_request: 4,
  plan_ttft: 2,
  perf_ui_first_token: 2,
  perf_ui_message_complete: 2,
  perf_ui_turn_breakdown: 2,
};

export function buildEarlyConversationTelemetryParityCases(): ConversationTelemetryParityCase[] {
  return [
    defineParityCase(
      "TDP01",
      buildStandardParitySequence({ caseId: "TDP01" }),
      reportOnce,
      armsOnce,
      ["draft-create-ack", "source-command-link"],
    ),
    defineParityCase(
      "TDP02",
      [
        ...buildStandardParitySequence({ caseId: "TDP02A", sessionId: "tdp02-session" }),
        ...buildStandardParitySequence({
          caseId: "TDP02B",
          sessionId: "tdp02-session",
          sendAt: 400,
          chunkAt: 500,
          terminalAt: 600,
        }),
      ],
      reportTwice,
      armsTwice,
      ["same-talk-id", "message-scope-reset"],
    ),
    defineParityCase("TDP03", buildTdp03Operations(), reportTwice, armsTwice, [
      "queued-before-first-terminal",
      "promotion-seed-deduped",
    ]),
    defineParityCase(
      "TDP04",
      buildStandardParitySequence({ caseId: "TDP04" }),
      reportOnce,
      armsOnce,
      ["success-usage", "runtime-model-hostname"],
    ),
    defineParityCase("TDP05", buildTdp05Operations(), reportTwice, armsTwice, [
      "failed-with-usage",
      "failed-without-usage",
    ]),
    defineParityCase(
      "TDP06",
      buildTdp06Operations(),
      { send_btn: 2, agent_step: 1, message_completion: 1 },
      {
        plan_ttft: 1,
        perf_ui_first_token: 1,
        perf_ui_message_complete: 1,
        perf_ui_turn_breakdown: 1,
      },
      ["interrupted-terminal", "stop-without-terminal-zero-completion"],
    ),
    defineParityCase(
      "TDP07",
      buildTdp07Operations(),
      { send_btn: 1, agent_step: 2, message_completion: 1 },
      {
        plan_ttft: 1,
        perf_ui_first_token: 1,
        perf_ui_message_complete: 1,
        perf_ui_turn_breakdown: 1,
      },
      ["thought-before-text", "tail-finalize"],
    ),
    defineParityCase(
      "TDP08",
      buildTdp08Operations(),
      { send_btn: 4, agent_step: 5, message_completion: 4 },
      {
        plan_ttft: 4,
        perf_ui_first_token: 4,
        perf_ui_message_complete: 4,
        perf_ui_turn_breakdown: 4,
        perf_ui_tool_call_detail: 3,
      },
      ["tool-success", "tool-failed", "permission-wait", "parented-child"],
    ),
  ];
}

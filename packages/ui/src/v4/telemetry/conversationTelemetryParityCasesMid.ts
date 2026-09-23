import {
  PARITY_PROMPT_SEED,
  buildStandardParitySequence,
  defineParityCase,
  type ConversationTelemetryParityCase,
  type ParityOperation,
} from "@/v4/telemetry/conversationTelemetryParityModel.js";

function buildTdp09Operations(): ParityOperation[] {
  const operations = buildStandardParitySequence({ caseId: "TDP09", includeNetwork: true });
  const terminalIndex = operations.findIndex((operation) => operation.kind === "terminal");
  operations.splice(terminalIndex, 0, { kind: "foreground.detach", owner: "tdp09-owner" });
  operations.push({
    kind: "foreground.attach",
    sessionId: "tdp09-session",
    owner: "tdp09-reopen",
  });
  return operations;
}

function buildTdp10Operations(): ParityOperation[] {
  const operations: ParityOperation[] = [];
  const samples = [
    { name: "negative", sendAt: 200, firstAt: 100, secondAt: undefined },
    { name: "no-token", sendAt: 500, firstAt: undefined, secondAt: undefined },
    { name: "gap-3000", sendAt: 800, firstAt: 900, secondAt: 3900 },
    { name: "gap-3001", sendAt: 4200, firstAt: 4300, secondAt: 7301 },
    { name: "tool-clear", sendAt: 7600, firstAt: 7700, secondAt: 13000 },
    { name: "split", sendAt: 13300, firstAt: 13400, secondAt: undefined },
  ] as const;
  for (const sample of samples) {
    const sessionId = `tdp10-${sample.name}-session`;
    const commandId = `tdp10-${sample.name}-command`;
    const turnId = `tdp10-${sample.name}-turn`;
    operations.push(
      {
        kind: "foreground.attach",
        sessionId,
        owner: `tdp10-${sample.name}-owner-1`,
      },
      ...(sample.name === "split"
        ? [
            {
              kind: "foreground.attach",
              sessionId,
              owner: "tdp10-split-owner-2",
            } satisfies ParityOperation,
          ]
        : []),
      {
        kind: "seed",
        sessionId,
        commandId,
        now: sample.sendAt,
        ...PARITY_PROMPT_SEED,
      },
      {
        kind: "turn.started",
        now: sample.sendAt + 1,
        eventId: `tdp10-${sample.name}-start`,
        sessionId,
        commandId,
        turnId,
      },
    );
    if (sample.firstAt !== undefined) {
      operations.push({
        kind: "chunk",
        now: sample.firstAt,
        eventId: `tdp10-${sample.name}-chunk-1`,
        sessionId,
        commandId,
        turnId,
        channel: "text",
        firstChunk: true,
      });
    }
    if (sample.name === "tool-clear") {
      operations.push(
        {
          kind: "tool",
          now: 11500,
          eventId: "tdp10-tool-clear-start",
          sessionId,
          commandId,
          turnId,
          phase: "started",
          toolCallId: "tdp10-tool-clear-tool",
          toolName: "Read",
        },
        {
          kind: "tool",
          now: 12000,
          eventId: "tdp10-tool-clear-complete",
          sessionId,
          commandId,
          turnId,
          phase: "completed",
          toolCallId: "tdp10-tool-clear-tool",
          toolName: "Read",
        },
      );
    }
    if (sample.secondAt !== undefined) {
      operations.push({
        kind: "chunk",
        now: sample.secondAt,
        eventId: `tdp10-${sample.name}-chunk-2`,
        sessionId,
        commandId,
        turnId,
        channel: "text",
        firstChunk: false,
      });
    }
    const lastMark = sample.secondAt ?? sample.firstAt ?? sample.sendAt;
    operations.push({
      kind: "terminal",
      now: Math.max(sample.sendAt + 200, lastMark + 100),
      eventId: `tdp10-${sample.name}-terminal`,
      sessionId,
      commandId,
      turnId,
      status: "success",
    });
  }
  return operations;
}

function buildTdp11Operations(): ParityOperation[] {
  const statuses = ["completed", "failed", "interrupted"] as const;
  return [
    ...statuses.map(
      (status) =>
        ({
          kind: "foreground.attach",
          sessionId: `tdp11-${status}-session`,
          owner: `tdp11-${status}-owner`,
        }) satisfies ParityOperation,
    ),
    ...statuses.map(
      (status, index) =>
        ({
          kind: "compaction",
          now: 200 + index * 100,
          eventId: `tdp11-${status}`,
          sessionId: `tdp11-${status}-session`,
          operationId: `tdp11-${status}-operation`,
          summaryMessageId: `tdp11-${status}-summary`,
          status,
          trigger: index === 0 ? "manual" : "auto",
          ...(index === 0 ? { reason: "manual request" } : {}),
          ...(index === 1 ? { compactReason: "context_limit" } : {}),
          modelName: index === 2 ? "glm-model" : "anthropic/model",
          modelProvider: index === 2 ? "glm" : "anthropic",
          startedAt: 100,
          endedAt: 150 + index * 10,
          preCompactTokenCount: 100,
          postCompactTokenCount: 40,
          truePostCompactTokenCount: 35,
        }) satisfies ParityOperation,
    ),
    {
      kind: "compaction",
      now: 600,
      eventId: "tdp11-duplicate",
      sessionId: "tdp11-completed-session",
      operationId: "tdp11-completed-operation",
      status: "failed",
      trigger: "manual",
      duplicate: true,
    },
    {
      kind: "compaction",
      now: 700,
      eventId: "tdp11-background",
      sessionId: "tdp11-background-session",
      operationId: "tdp11-background-operation",
      status: "completed",
      trigger: "auto",
      modelName: "glm-model",
      modelProvider: "glm",
    },
  ];
}

function buildTdp12Operations(): ParityOperation[] {
  const statuses = [
    "model_request_started",
    "model_request_completed",
    "model_request_failed",
    "model_retry_scheduled",
    "model_stream_stalled",
  ] as const;
  return statuses.flatMap((status, statusIndex) =>
    (["foreground", "background"] as const).map(
      (placement, placementIndex) =>
        ({
          kind: "model.status",
          now: 100 + statusIndex * 20 + placementIndex,
          eventId: `tdp12-${status}-${placement}`,
          sessionId: `tdp12-${placement}-session`,
          requestId: `tdp12-request-${placement}`,
          status,
          providerId: "custom-provider",
          modelId: "custom-model",
          providerHostname: "safe.example.com",
          ...(status === "model_request_started" ? {} : { durationMs: 20 + statusIndex }),
          ...(status === "model_request_failed" ? { reason: "failed" } : {}),
          ...(status === "model_retry_scheduled" ? { retryable: true, delayMs: 500 } : {}),
          ...(status === "model_stream_stalled" ? { idleMs: 3001, timeoutMs: 3000 } : {}),
        }) satisfies ParityOperation,
    ),
  );
}

function buildTdp13Operations(): ParityOperation[] {
  const operations: ParityOperation[] = [];
  const samples = [
    { name: "valid", sendAt: 100, chunkAt: 180, provider: "glm", foreground: true },
    { name: "negative", sendAt: 400, chunkAt: 350, provider: "glm", foreground: true },
    { name: "missing", sendAt: 700, chunkAt: 780, provider: "", foreground: true },
    { name: "background", sendAt: 1000, chunkAt: 1080, provider: "glm", foreground: false },
  ] as const;
  for (const sample of samples) {
    const sessionId = `tdp13-${sample.name}-session`;
    const commandId = `tdp13-${sample.name}-command`;
    const turnId = `tdp13-${sample.name}-turn`;
    if (sample.foreground) {
      operations.push({
        kind: "foreground.attach",
        sessionId,
        owner: `tdp13-${sample.name}-owner`,
      });
    }
    operations.push(
      {
        kind: "seed",
        sessionId,
        commandId,
        now: sample.sendAt,
        askMode: "build",
        modelName: "glm-model",
        modelProvider: sample.provider,
      },
      {
        kind: "turn.started",
        now: sample.sendAt + 1,
        eventId: `tdp13-${sample.name}-start`,
        sessionId,
        commandId,
        turnId,
      },
      {
        kind: "chunk",
        now: sample.chunkAt,
        eventId: `tdp13-${sample.name}-chunk`,
        sessionId,
        commandId,
        turnId,
        channel: "text",
        firstChunk: true,
      },
      {
        kind: "terminal",
        now: sample.sendAt + 200,
        eventId: `tdp13-${sample.name}-terminal`,
        sessionId,
        commandId,
        turnId,
        status: "success",
      },
    );
  }
  return operations;
}

export function buildMidConversationTelemetryParityCases(): ConversationTelemetryParityCase[] {
  return [
    defineParityCase(
      "TDP09",
      buildTdp09Operations(),
      { send_btn: 1, agent_step: 1, message_completion: 1 },
      { plan_request: 2 },
      ["terminal-after-detach", "reopen-no-replay", "background-ui-arms-zero"],
    ),
    defineParityCase(
      "TDP10",
      buildTdp10Operations(),
      { send_btn: 6, agent_step: 6, message_completion: 6 },
      {
        plan_ttft: 4,
        perf_ui_first_token: 6,
        perf_ui_message_complete: 6,
        perf_ui_turn_breakdown: 6,
        perf_ui_stream_stall: 1,
      },
      [
        "negative-ttft-clamped",
        "no-token",
        "stall-3000-zero",
        "stall-3001-one",
        "tool-clears-stall",
        "split-pane-once",
      ],
    ),
    defineParityCase("TDP11", buildTdp11Operations(), { context_compaction: 3 }, {}, [
      "three-terminal-statuses",
      "nonterminal-zero",
      "duplicate-operation-zero",
      "background-zero",
      "legacy-model-encoding",
    ]),
    defineParityCase("TDP12", buildTdp12Operations(), {}, { plan_request: 10 }, [
      "five-network-statuses",
      "foreground-background",
      "accepted-queued-apiRetry-zero",
      "hostname-only",
    ]),
    defineParityCase(
      "TDP13",
      buildTdp13Operations(),
      { send_btn: 4, agent_step: 4, message_completion: 4 },
      {
        plan_ttft: 1,
        perf_ui_first_token: 3,
        perf_ui_message_complete: 3,
        perf_ui_turn_breakdown: 3,
      },
      ["valid-ttft", "negative-no-plan-ttft", "missing-provider-no-plan-ttft", "background-zero"],
    ),
  ];
}

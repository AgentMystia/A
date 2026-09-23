import {
  PARITY_PROMPT_SEED,
  type ParityOperation,
} from "@/v4/telemetry/conversationTelemetryParityModel.js";

function pushTdp08Tool(operations: ParityOperation[], name: string, at: number): void {
  const sessionId = `tdp08-${name}-session`;
  const commandId = `tdp08-${name}-command`;
  const turnId = `tdp08-${name}-turn`;
  const failed = name === "failed";
  const permission = name === "permission";
  if (permission) {
    operations.push({
      kind: "permission",
      now: at + 20,
      eventId: "tdp08-permission-request",
      sessionId,
      commandId,
      turnId,
      phase: "requested",
      requestId: "tdp08-permission",
      toolCallId: "tdp08-permission-tool",
    });
  }
  operations.push(
    {
      kind: "tool",
      now: at + 30,
      eventId: `tdp08-${name}-tool-start`,
      sessionId,
      commandId,
      turnId,
      phase: "started",
      toolCallId: `tdp08-${name}-tool`,
      toolName: failed ? "Bash" : "Read",
    },
    ...(permission
      ? [
          {
            kind: "permission",
            now: at + 80,
            eventId: "tdp08-permission-resolved",
            sessionId,
            commandId,
            turnId,
            phase: "resolved",
            requestId: "tdp08-permission",
            toolCallId: "tdp08-permission-tool",
            decision: "allow",
          } satisfies ParityOperation,
        ]
      : []),
    {
      kind: "tool",
      now: at + 120,
      eventId: `tdp08-${name}-tool-terminal`,
      sessionId,
      commandId,
      turnId,
      phase: failed ? "failed" : "completed",
      toolCallId: `tdp08-${name}-tool`,
      toolName: failed ? "Bash" : "Read",
      ...(failed ? { errorCode: "TOOL_EXEC_ERROR", errorMessage: "exit 2" } : {}),
      performance: {
        totalMs: 90,
        permissionWaitMs: permission ? 60 : 0,
        commandRunMs: permission ? 30 : 90,
        exitCode: failed ? 2 : 0,
        timedOut: false,
        outputBytes: 12,
        commandCategory: "read",
        commandHash: "0123456789abcdef",
        workspaceKind: "local",
      },
    },
  );
}

export function buildTdp08Operations(): ParityOperation[] {
  const operations: ParityOperation[] = [];
  for (const [index, name] of ["success", "failed", "permission", "parented"].entries()) {
    const sessionId = `tdp08-${name}-session`;
    const commandId = `tdp08-${name}-command`;
    const turnId = `tdp08-${name}-turn`;
    const at = 100 + index * 500;
    operations.push(
      { kind: "foreground.attach", sessionId, owner: `tdp08-${name}-owner` },
      { kind: "seed", sessionId, commandId, now: at, ...PARITY_PROMPT_SEED },
      {
        kind: "turn.started",
        now: at + 10,
        eventId: `tdp08-${name}-start`,
        sessionId,
        commandId,
        turnId,
      },
    );
    if (name === "parented") {
      operations.push(
        {
          kind: "chunk",
          now: at + 30,
          eventId: "tdp08-parented-thought",
          sessionId,
          commandId,
          turnId,
          channel: "thought",
          firstChunk: true,
          parentToolCallId: "parent-agent",
        },
        {
          kind: "chunk",
          now: at + 40,
          eventId: "tdp08-parented-text",
          sessionId,
          commandId,
          turnId,
          channel: "text",
          firstChunk: false,
          parentToolCallId: "parent-agent",
        },
        {
          kind: "chunk",
          now: at + 60,
          eventId: "tdp08-main-text",
          sessionId,
          commandId,
          turnId,
          channel: "text",
          firstChunk: false,
        },
      );
    } else {
      pushTdp08Tool(operations, name, at);
    }
    operations.push({
      kind: "terminal",
      now: at + 200,
      eventId: `tdp08-${name}-terminal`,
      sessionId,
      commandId,
      turnId,
      status: "success",
    });
  }
  return operations;
}

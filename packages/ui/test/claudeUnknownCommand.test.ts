import assert from "node:assert/strict";
import test from "node:test";

import {
  parseClaudeUnknownCommandMessage,
  resolveClaudeUnknownCommandMessage,
} from "../src/lib/claudeUnknownCommand.js";

test("parse Claude unknown command with and without args", () => {
  assert.deepEqual(parseClaudeUnknownCommandMessage("Claude Code 未知命令 foo。"), {
    command: "foo",
  });
  assert.deepEqual(parseClaudeUnknownCommandMessage("Claude Code 未知命令 plan（参数：--yes）。"), {
    command: "plan",
    args: "--yes",
  });
  assert.equal(parseClaudeUnknownCommandMessage("something else"), null);
});

test("resolve Claude unknown command message ids", () => {
  const calls: Array<{ id: string; values?: Record<string, string> }> = [];
  const formatMessage = (descriptor: { id: string }, values?: Record<string, string>) => {
    calls.push({ id: descriptor.id, values });
    return descriptor.id;
  };

  assert.equal(
    resolveClaudeUnknownCommandMessage(
      { code: "CLAUDE_UNKNOWN_COMMAND", message: "Claude Code 未知命令 plan（参数：--yes）。" },
      formatMessage,
    ),
    "zcode.error.CLAUDE_UNKNOWN_COMMAND_WITH_ARGS",
  );
  assert.equal(
    resolveClaudeUnknownCommandMessage(
      { code: "CLAUDE_UNKNOWN_COMMAND", message: "Claude Code 未知命令 plan。" },
      formatMessage,
    ),
    "zcode.error.CLAUDE_UNKNOWN_COMMAND",
  );
  assert.equal(
    resolveClaudeUnknownCommandMessage(
      { code: "CLAUDE_UNKNOWN_COMMAND", message: "raw" },
      formatMessage,
    ),
    "raw",
  );
  assert.equal(
    resolveClaudeUnknownCommandMessage({ code: "OTHER", message: "raw" }, formatMessage),
    null,
  );
  assert.deepEqual(calls, [
    {
      id: "zcode.error.CLAUDE_UNKNOWN_COMMAND_WITH_ARGS",
      values: { command: "plan", args: "--yes" },
    },
    { id: "zcode.error.CLAUDE_UNKNOWN_COMMAND", values: { command: "plan" } },
  ]);
});

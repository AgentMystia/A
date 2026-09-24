import assert from "node:assert/strict";
import test from "node:test";

import { CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID } from "@zcode/shared";

import { resolveSkillDisplayDescription } from "../src/lib/builtinSkillI18n.js";
import { createCommandEnvelope } from "../src/v4/commandFactory.js";

test("restore-legacy-sessions uses the published skill descriptions", () => {
  const skill = {
    name: "restore-legacy-sessions",
    description: "raw",
    path: "/cache/restore-legacy-sessions-plugin/skills/restore-legacy-sessions/SKILL.md",
    scope: "plugin" as const,
    pluginName: "restore-legacy-sessions",
  };
  assert.equal(
    resolveSkillDisplayDescription(skill, "zh-CN"),
    "检查、规划或执行 ACP 时代 ZCode 旧 session 恢复到新的 ZCode 任务与会话库。",
  );
  assert.equal(
    resolveSkillDisplayDescription(skill, "en-US"),
    "Inspect, plan, or restore old ACP-era ZCode sessions into the new ZCode task and session stores.",
  );
});

test("CAS commands name protocol section 6.4", () => {
  assert.throws(
    () =>
      createCommandEnvelope({
        type: "retryTurn",
        payload: {} as never,
        sessionId: "session-1",
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message ===
        "command retryTurn 是 CAS 命令，必须携带 baseRevision（10-protocol-spec §6.4）",
  );
});

test("personal marketplace id keeps the published value", () => {
  assert.equal(CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID, "claude-plugins-official");
});

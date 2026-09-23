import assert from "node:assert/strict";
import test from "node:test";

import { zcodeTaskSyncCursorSchema } from "../src/validation.js";

test("task sync cursor matches the published provider and state words", () => {
  const parsed = zcodeTaskSyncCursorSchema.parse({
    provider: "claude",
    sessionId: "session-1",
    lastSyncedTurnIndex: -1,
    state: "syncing",
  });
  assert.equal(parsed.provider, "claude");
  assert.equal(parsed.lastSyncedTurnIndex, -1);
  assert.equal(parsed.state, "syncing");
  assert.equal(
    zcodeTaskSyncCursorSchema.safeParse({
      provider: "glm",
      sessionId: "session-1",
      lastSyncedTurnIndex: 2,
      state: "paused",
    }).success,
    false,
  );
  assert.equal(
    zcodeTaskSyncCursorSchema.safeParse({
      provider: "gpt",
      sessionId: "session-1",
      lastSyncedTurnIndex: 2,
      state: "idle",
    }).success,
    false,
  );
});

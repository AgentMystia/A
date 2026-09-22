import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ZCodeConfigOption } from "@zcode/shared";
import {
  getModeConfigOption,
  normalizePersistedSessionMode,
  resolveProviderModeIdFromConfigOptions,
} from "../src/bots/botsHostHelpers.js";
import { resolveSupportedDraftMode } from "../src/bots/botsDraft.js";
import {
  acquireBotRuntimeLock,
  isBotRuntimeLockCleanupRetryable,
  isBotRuntimeLockConflictError,
} from "../src/bots/botsLocks.js";
import { setDataBaseDir } from "../src/paths.js";

function nodeError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function modeOption(values: string[]): ZCodeConfigOption {
  return {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue: values[0] ?? "",
    options: values.map((value) => ({ value, name: value })),
  };
}

test("bot runtime lock errors match published codes", () => {
  assert.equal(isBotRuntimeLockConflictError(nodeError("EEXIST")), true);
  assert.equal(isBotRuntimeLockConflictError(nodeError("ENOTEMPTY")), true);
  assert.equal(isBotRuntimeLockConflictError(nodeError("EISDIR")), true);
  assert.equal(isBotRuntimeLockConflictError(nodeError("EPERM")), true);
  assert.equal(isBotRuntimeLockConflictError(nodeError("EBUSY")), false);
  assert.equal(isBotRuntimeLockConflictError({ code: "EEXIST" }), false);
  assert.equal(isBotRuntimeLockCleanupRetryable(nodeError("EBUSY")), true);
  assert.equal(isBotRuntimeLockCleanupRetryable(nodeError("ENOTEMPTY")), true);
  assert.equal(isBotRuntimeLockCleanupRetryable(nodeError("EPERM")), true);
  assert.equal(isBotRuntimeLockCleanupRetryable(nodeError("EEXIST")), false);
});

test("resolveSupportedDraftMode keeps the caller mode id when an alias matches", () => {
  const options = [modeOption(["plan", "yolo"])];
  assert.equal(getModeConfigOption([{ ...modeOption(["yolo"]), category: "other" }]), undefined);
  assert.equal(normalizePersistedSessionMode("full-auto", "glm"), "yolo");
  assert.equal(normalizePersistedSessionMode("agent", "codex"), "default");
  assert.equal(normalizePersistedSessionMode("agent", "glm"), undefined);
  assert.equal(
    resolveProviderModeIdFromConfigOptions({
      configOptions: options,
      modeId: "read-only",
      provider: "glm",
    }),
    "plan",
  );
  assert.equal(resolveSupportedDraftMode(options, "read-only", "glm"), "read-only");
  assert.equal(resolveSupportedDraftMode(options, "missing", "glm"), undefined);
});

test("acquireBotRuntimeLock releases a temp lock directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bot-lock-"));
  setDataBaseDir(dir);
  try {
    const lock = await acquireBotRuntimeLock("telegram-polling", "credential", "bot-1");
    assert.ok(lock);
    await lock.release();
    const again = await acquireBotRuntimeLock("telegram-polling", "credential", "bot-1");
    assert.ok(again);
    await again.release();
  } finally {
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

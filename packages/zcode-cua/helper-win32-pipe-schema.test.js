import assert from "node:assert/strict";
import test from "node:test";

import { win32NamedPipeParentSchema } from "./helper-win32-pipe-schema.js";

const PIPE_PREFIX = "\\\\.\\pipe\\";

test("win32 named pipe parent schema matches the published refine", () => {
  assert.equal(PIPE_PREFIX.length, 9);
  const parsed = win32NamedPipeParentSchema.parse({
    platform: "win32",
    socketPath: `${PIPE_PREFIX}zcode`,
    parentPid: "4",
  });
  assert.deepEqual(parsed, {
    platform: "win32",
    socketPath: `${PIPE_PREFIX}zcode`,
    parentPid: 4,
  });
  assert.equal(
    win32NamedPipeParentSchema.safeParse({
      platform: "win32",
      socketPath: PIPE_PREFIX,
      parentPid: 4,
    }).success,
    false,
  );
  assert.equal(
    win32NamedPipeParentSchema.safeParse({
      platform: "darwin",
      socketPath: `${PIPE_PREFIX}zcode`,
      parentPid: 4,
    }).success,
    false,
  );
  assert.equal(
    win32NamedPipeParentSchema.safeParse({
      platform: "win32",
      socketPath: "/tmp/broker.sock",
      parentPid: 4,
    }).success,
    false,
  );
});

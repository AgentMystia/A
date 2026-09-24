import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  businessResponseTimeout,
  publishedHoldSlackMs,
  publishedUnusedRefreshMs,
} from "./helper-hold-duration.js";
import "./helper-published-connection.js";
import { publishedUnusedAsyncLocalStorage } from "./helper-published-async-local.js";
import { publishedUnusedDeadlineKeys } from "./helper-published-deadline-keys.js";
import { readFileSync as publishedLaunchReadFileSync } from "./helper-published-launch-bindings.js";
import { publishedUnusedPeerCheck } from "./helper-published-peer-freeze.js";
import { PUBLISHED_UNUSED_BYTE_CEILING } from "./helper-published-byte-ceiling.js";
import { publishedUnusedTempReadLimit } from "./helper-published-temp-limit.js";
import { defaultPeerCredentialChecker } from "./permissionBrokerClient.js";

test("published hold window keeps the unused 30s var and the 5s slack", () => {
  assert.equal(publishedUnusedRefreshMs, 30 * 1e3);
  assert.equal(publishedHoldSlackMs, 5 * 1e3);
  assert.equal(businessResponseTimeout(3000, "hold_key", { duration: 10 }), 15_000);
});

test("published peer freeze is empty and is not the real checker", () => {
  assert.equal(Object.isFrozen(publishedUnusedPeerCheck), true);
  assert.equal(publishedUnusedPeerCheck.verifySocketPeer("socket", {}), undefined);
  assert.equal(typeof defaultPeerCredentialChecker, "function");
  assert.notEqual(publishedUnusedPeerCheck, defaultPeerCredentialChecker({}));
});

test("published connection residue exports nothing", async () => {
  const residue = await import("./helper-published-connection.js");
  assert.deepEqual(Object.keys(residue), []);
});

test("published temp residue keeps the unused 16MiB var and does not read files", async () => {
  assert.equal(publishedUnusedTempReadLimit, 16 * 1024 * 1024);
  assert.equal(PUBLISHED_UNUSED_BYTE_CEILING, 128 * 1024 * 1024);
  assert.equal(publishedLaunchReadFileSync, readFileSync);
  const scan = await import("./helper-published-temp-scan.js");
  const read = await import("./helper-published-temp-read.js");
  const ceilingImports = await import("./helper-published-ceiling-imports.js");
  const spawn = await import("./helper-published-temp-spawn.js");
  const fsResidue = await import("./helper-published-temp-fs.js");
  const requireResidue = await import("./helper-published-temp-require.js");
  assert.deepEqual(Object.keys(scan), []);
  assert.deepEqual(Object.keys(read), []);
  assert.deepEqual(Object.keys(ceilingImports), []);
  assert.deepEqual(Object.keys(spawn), []);
  assert.deepEqual(Object.keys(fsResidue), []);
  assert.deepEqual(Object.keys(requireResidue), []);
});

test("published async local storage and deadline keys stay unused constants", () => {
  assert.equal(publishedUnusedAsyncLocalStorage instanceof AsyncLocalStorage, true);
  assert.equal(Object.isFrozen(publishedUnusedDeadlineKeys), true);
  assert.deepEqual([...publishedUnusedDeadlineKeys], ["schema", "kind", "deadlineEpochMs"]);
});

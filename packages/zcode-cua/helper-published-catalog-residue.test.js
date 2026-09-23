import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import test from "node:test";

import {
  businessResponseTimeout,
  publishedHoldSlackMs,
  publishedUnusedRefreshMs,
} from "./helper-hold-duration.js";
import { publishedUnusedPeerCheck } from "./helper-published-peer-freeze.js";
import "./helper-published-connection.js";
import { publishedUnusedAsyncLocalStorage } from "./helper-published-async-local.js";
import { publishedUnusedDeadlineKeys } from "./helper-published-deadline-keys.js";
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

test("published async local storage and deadline keys stay unused constants", () => {
  assert.equal(publishedUnusedAsyncLocalStorage instanceof AsyncLocalStorage, true);
  assert.equal(Object.isFrozen(publishedUnusedDeadlineKeys), true);
  assert.deepEqual([...publishedUnusedDeadlineKeys], ["schema", "kind", "deadlineEpochMs"]);
});

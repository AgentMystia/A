import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import test from "node:test";

import {
  publishedUnusedRefreshGraceMs,
  publishedUnusedRefreshMs,
} from "./helper-published-refresh-window.js";
import { publishedUnusedPeerCheck } from "./helper-published-peer-freeze.js";
import { publishedUnusedAsyncLocalStorage } from "./helper-published-async-local.js";
import { publishedUnusedDeadlineKeys } from "./helper-published-deadline-keys.js";
import { defaultPeerCredentialChecker } from "./permissionBrokerClient.js";

test("published catalog residue keeps the unused refresh pair", () => {
  assert.equal(publishedUnusedRefreshMs, 30 * 1e3);
  assert.equal(publishedUnusedRefreshGraceMs, 5 * 1e3);
});

test("published peer freeze is empty and is not the real checker", () => {
  assert.equal(Object.isFrozen(publishedUnusedPeerCheck), true);
  assert.equal(publishedUnusedPeerCheck.verifySocketPeer("socket", {}), undefined);
  assert.equal(typeof defaultPeerCredentialChecker, "function");
  assert.notEqual(publishedUnusedPeerCheck, defaultPeerCredentialChecker({}));
});

test("published async local storage and deadline keys stay unused constants", () => {
  assert.equal(publishedUnusedAsyncLocalStorage instanceof AsyncLocalStorage, true);
  assert.equal(Object.isFrozen(publishedUnusedDeadlineKeys), true);
  assert.deepEqual([...publishedUnusedDeadlineKeys], ["schema", "kind", "deadlineEpochMs"]);
});

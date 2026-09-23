import assert from "node:assert/strict";
import test from "node:test";

import {
  isMobileActiveTask,
  resolveMobileActiveTaskKey,
  resolveMobileActiveTaskListRefresh,
} from "../src/web-remote/mobileActiveTaskKey.js";

test("mobile active key requires a connected phone and both view fields", () => {
  assert.equal(
    resolveMobileActiveTaskKey({
      mobileConnected: true,
      mobileViewState: { activeWorkspaceKey: "ws", activeTaskId: "task" },
    }),
    "ws:task",
  );
  assert.equal(
    resolveMobileActiveTaskKey({
      mobileConnected: false,
      mobileViewState: { activeWorkspaceKey: "ws", activeTaskId: "task" },
    }),
    null,
  );
  assert.equal(
    resolveMobileActiveTaskKey({
      mobileConnected: true,
      mobileViewState: { activeTaskId: "task" },
    }),
    null,
  );
  assert.equal(
    resolveMobileActiveTaskKey({
      mobileConnected: true,
      mobileViewState: { activeWorkspaceKey: "ws" },
    }),
    null,
  );
  assert.equal(resolveMobileActiveTaskKey({ mobileConnected: true }), null);
});

test("row match uses workspace key and task id without trimming the stored key", () => {
  assert.equal(isMobileActiveTask("ws:task", "ws", "task"), true);
  assert.equal(isMobileActiveTask("ws:task", "other", "task"), false);
  assert.equal(isMobileActiveTask("ws:task", "ws", "other"), false);
  assert.equal(isMobileActiveTask(null, "ws", "task"), false);
  assert.equal(isMobileActiveTask(" ws:task", "ws", "task"), false);
});

test("missing visible task refreshes once per trimmed key", () => {
  const first = resolveMobileActiveTaskListRefresh({
    mobileConnected: true,
    activeWorkspaceKey: " ws ",
    activeTaskId: " task ",
    taskIsVisible: false,
    lastRefreshKey: null,
  });
  assert.deepEqual(first, { nextRefreshKey: "ws:task", refresh: true });

  const repeat = resolveMobileActiveTaskListRefresh({
    mobileConnected: true,
    activeWorkspaceKey: "ws",
    activeTaskId: "task",
    taskIsVisible: false,
    lastRefreshKey: first.nextRefreshKey,
  });
  assert.deepEqual(repeat, { nextRefreshKey: "ws:task", refresh: false });
});

test("visible task or a dropped connection clears the refresh record", () => {
  assert.deepEqual(
    resolveMobileActiveTaskListRefresh({
      mobileConnected: true,
      activeWorkspaceKey: "ws",
      activeTaskId: "task",
      taskIsVisible: true,
      lastRefreshKey: "ws:task",
    }),
    { nextRefreshKey: null, refresh: false },
  );
  assert.deepEqual(
    resolveMobileActiveTaskListRefresh({
      mobileConnected: false,
      activeWorkspaceKey: "ws",
      activeTaskId: "task",
      taskIsVisible: false,
      lastRefreshKey: "ws:task",
    }),
    { nextRefreshKey: null, refresh: false },
  );
  assert.deepEqual(
    resolveMobileActiveTaskListRefresh({
      mobileConnected: true,
      activeWorkspaceKey: "   ",
      activeTaskId: "task",
      taskIsVisible: false,
      lastRefreshKey: "old",
    }),
    { nextRefreshKey: null, refresh: false },
  );
});

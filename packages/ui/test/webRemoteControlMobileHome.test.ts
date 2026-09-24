import assert from "node:assert/strict";
import test from "node:test";
import type {
  WebRemoteControlTaskSnapshot,
  WebRemoteControlWorkspaceSnapshot,
} from "@zcode/shared";

import {
  buildMobileTaskHomeView,
  compareMobileRemoteTasks,
  groupMobileTasksByWorkspace,
  isMobileTaskOpenHomeFailure,
  isRemoteWorkspaceDisconnected,
  readMobileTaskHomePreferences,
  stringifyMobileHomeError,
  writeMobileTaskHomePreferences,
  MOBILE_TASK_HOME_PREFERENCES_KEY,
} from "../src/web-remote/mobile/webRemoteControlMobileModel.js";

function task(
  patch: Partial<WebRemoteControlTaskSnapshot> & Pick<WebRemoteControlTaskSnapshot, "taskId">,
): WebRemoteControlTaskSnapshot {
  return {
    title: patch.taskId,
    workspacePath: "/work",
    workspaceLabel: "work",
    workspaceKind: "local",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function workspace(
  patch: Partial<WebRemoteControlWorkspaceSnapshot> &
    Pick<WebRemoteControlWorkspaceSnapshot, "workspacePath">,
): WebRemoteControlWorkspaceSnapshot {
  return {
    label: patch.workspacePath,
    kind: "local",
    ...patch,
  };
}

test("running mobile tasks stay above idle tasks and ignore updatedAt", () => {
  const running = task({
    taskId: "run",
    displayStatus: "running",
    createdAt: 10,
    updatedAt: 10,
  });
  const idleNewer = task({ taskId: "idle", createdAt: 50, updatedAt: 500 });
  assert.ok(compareMobileRemoteTasks(running, idleNewer, "updated") < 0);
  const background = task({
    taskId: "bg",
    hasBackgroundWork: true,
    createdAt: 30,
    updatedAt: 1,
  });
  assert.ok(compareMobileRemoteTasks(background, running, "updated") < 0);
});

test("workspace groups stay on updated order while the timeline follows created", () => {
  const olderUpdate = task({ taskId: "old", createdAt: 100, updatedAt: 10 });
  const newerUpdate = task({ taskId: "new", createdAt: 1, updatedAt: 90 });
  const groups = groupMobileTasksByWorkspace(
    [workspace({ workspacePath: "/work" })],
    [olderUpdate, newerUpdate],
  );
  assert.deepEqual(
    groups[0]?.tasks.map((item) => item.taskId),
    ["new", "old"],
  );
  const view = buildMobileTaskHomeView({
    activeWorkspacePath: "/work",
    sortBy: "created",
    result: {
      workspaces: [workspace({ workspacePath: "/work" })],
      tasks: [olderUpdate, newerUpdate],
    },
  });
  assert.deepEqual(
    view.timelineTasks.map((item) => item.taskId),
    ["old", "new"],
  );
  assert.deepEqual(
    view.groups[0]?.tasks.map((item) => item.taskId),
    ["new", "old"],
  );
  assert.equal(view.defaultExpandedWorkspaceKeys.has("/work"), true);
});

test("remote workspaces without a session are disconnected", () => {
  assert.equal(
    isRemoteWorkspaceDisconnected(
      workspace({ workspacePath: "/remote", kind: "remote", connectionState: "connected" }),
    ),
    true,
  );
  assert.equal(
    isRemoteWorkspaceDisconnected(
      workspace({
        workspacePath: "/remote",
        kind: "remote",
        connectionState: "connected",
        remoteSessionId: "session",
      }),
    ),
    false,
  );
});

test("task open failures that require a reconnect return home", () => {
  assert.equal(isMobileTaskOpenHomeFailure("远程工作区尚未连接"), true);
  assert.equal(isMobileTaskOpenHomeFailure("请先重连当前窗口"), true);
  assert.equal(isMobileTaskOpenHomeFailure("network down"), false);
});

test("mobile home errors and preferences keep the published fallbacks", () => {
  assert.equal(stringifyMobileHomeError(new Error("boom")), "boom");
  assert.equal(stringifyMobileHomeError({ message: "plain" }), "plain");
  const storage = new Map<string, string>();
  const memory = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  };
  assert.deepEqual(readMobileTaskHomePreferences(memory), {
    organizeBy: "workspace",
    sortBy: "updated",
  });
  memory.setItem(MOBILE_TASK_HOME_PREFERENCES_KEY, JSON.stringify({ organizeBy: "nope" }));
  assert.equal(readMobileTaskHomePreferences(memory).organizeBy, "workspace");
  writeMobileTaskHomePreferences({ organizeBy: "timeline", sortBy: "created" }, memory);
  assert.deepEqual(readMobileTaskHomePreferences(memory), {
    organizeBy: "timeline",
    sortBy: "created",
  });
});

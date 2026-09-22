import assert from "node:assert/strict";
import test from "node:test";

import type {
  WebRemoteControlTaskSnapshot,
  WebRemoteControlWorkspaceSnapshot,
} from "@zcode/shared";
import {
  loadWebRemoteTaskIndex,
  openWebRemoteIndexedTask,
} from "../src/web-remote/task-index/webRemoteControlTaskIndexActions.js";
import {
  buildWebRemoteTaskIndexView,
  filterWebRemoteTaskIndexWorkspaces,
  isWebRemoteMutableWorkspace,
  mapWebRemoteWorkspaceServices,
  patchWebRemoteTaskMembership,
  pruneCollapsedWorkspaceKeys,
  shouldRetryEmptyWebRemoteTaskIndex,
  toggleCollapsedWorkspaceKey,
  WEB_REMOTE_TASK_INDEX_EMPTY_MAX_ATTEMPTS,
} from "../src/web-remote/task-index/webRemoteControlTaskIndexModel.js";
import type { WebRemoteControlMobileWorkspaceList } from "../src/web-remote/mobile/webRemoteControlMobileTypes.js";

function workspace(
  overrides: Partial<WebRemoteControlWorkspaceSnapshot> &
    Pick<WebRemoteControlWorkspaceSnapshot, "workspacePath" | "label" | "kind">,
): WebRemoteControlWorkspaceSnapshot {
  return overrides;
}

function task(
  overrides: Partial<WebRemoteControlTaskSnapshot> &
    Pick<WebRemoteControlTaskSnapshot, "taskId" | "workspacePath">,
): WebRemoteControlTaskSnapshot {
  return {
    title: overrides.taskId,
    workspaceLabel: "workspace",
    workspaceKind: "local",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("empty index retries only while an active task has no rows", () => {
  assert.equal(
    shouldRetryEmptyWebRemoteTaskIndex({
      activeTaskId: "task-1",
      attempt: 0,
      maxAttempts: WEB_REMOTE_TASK_INDEX_EMPTY_MAX_ATTEMPTS,
      taskCount: 0,
    }),
    true,
  );
  assert.equal(
    shouldRetryEmptyWebRemoteTaskIndex({
      activeTaskId: "task-1",
      attempt: WEB_REMOTE_TASK_INDEX_EMPTY_MAX_ATTEMPTS,
      maxAttempts: WEB_REMOTE_TASK_INDEX_EMPTY_MAX_ATTEMPTS,
      taskCount: 0,
    }),
    false,
  );
  assert.equal(
    shouldRetryEmptyWebRemoteTaskIndex({
      activeTaskId: null,
      attempt: 0,
      maxAttempts: WEB_REMOTE_TASK_INDEX_EMPTY_MAX_ATTEMPTS,
      taskCount: 0,
    }),
    false,
  );
});

test("load stops after the snapshot arrives and records the last empty wait", async () => {
  const seen: number[] = [];
  let calls = 0;
  const outcome = await loadWebRemoteTaskIndex({
    activeTaskId: "task-1",
    activeWorkspaceIdentity: "remote",
    activeWorkspacePath: "/repo",
    listWorkspaces: async () => {
      calls += 1;
      if (calls < 3) return { workspaces: [], tasks: [] };
      return {
        workspaces: [],
        tasks: [task({ taskId: "task-1", workspacePath: "/repo" })],
      };
    },
    isCancelled: () => false,
    onResult: (result) => {
      seen.push(result.tasks?.length ?? 0);
    },
    delay: async () => undefined,
  });
  assert.equal(outcome, "ready");
  assert.deepEqual(seen, [0, 0, 1]);
  assert.equal(calls, 3);
});

test("membership patch deletes false flags instead of storing them", () => {
  const current: WebRemoteControlMobileWorkspaceList = {
    workspaces: [],
    tasks: [task({ taskId: "task-1", workspacePath: "/repo", pinned: true, archived: true })],
  };
  const next = patchWebRemoteTaskMembership(current, current.tasks![0]!, {
    pinned: false,
    archived: false,
  });
  assert.equal("pinned" in next.tasks![0]!, false);
  assert.equal("archived" in next.tasks![0]!, false);
});

test("workspace groups collapse in memory and search matches identity", () => {
  const remote = workspace({
    workspacePath: "/repo",
    workspaceIdentity: "remote",
    label: "Repo",
    kind: "remote",
  });
  const view = buildWebRemoteTaskIndexView({
    result: {
      workspaces: [remote],
      tasks: [
        task({
          taskId: "visible",
          workspacePath: "/repo",
          workspaceIdentity: "remote",
          title: "notes",
          remoteSessionId: "session-1",
          updatedAt: 2,
        }),
        task({
          taskId: "hidden",
          workspacePath: "/repo",
          workspaceIdentity: "remote",
          title: "other",
          updatedAt: 3,
        }),
      ],
    },
    viewMode: "workspace",
    sortBy: "updated",
    searchQuery: "session-1",
    collapsedWorkspaceKeys: new Set(["remote"]),
  });
  assert.equal(view.groups.length, 1);
  assert.equal(view.groups[0]?.collapsed, true);
  assert.equal(view.groups[0]?.tasks.length, 0);
  assert.equal(view.groups[0]?.totalTaskCount, 1);
  assert.equal(view.totalTaskCount, 1);
});

test("active identity limits service resolution to remote workspaces", () => {
  const local = workspace({ workspacePath: "/local", label: "Local", kind: "local" });
  const remote = workspace({
    workspacePath: "/repo",
    workspaceIdentity: "remote",
    remoteSessionId: "session-1",
    label: "Repo",
    kind: "remote",
  });
  assert.equal(isWebRemoteMutableWorkspace(local), false);
  assert.deepEqual(
    filterWebRemoteTaskIndexWorkspaces("remote", [local, remote]).map((item) => item.workspacePath),
    ["/repo"],
  );
  const localServices = { zcodeTaskService: { marker: "local" } };
  const remoteServices = { zcodeTaskService: { marker: "remote" } };
  const sessions = {
    sessionsById: { "session-1": { services: remoteServices as never } },
    sessionIdByWorkspaceIdentity: { remote: "session-1" },
    sessionIdByWorkspacePath: {},
  };
  const resolved = mapWebRemoteWorkspaceServices([local, remote], localServices as never, sessions);
  const localEntry = resolved.get("/local");
  const remoteEntry = resolved.get("remote");
  assert.ok(localEntry);
  assert.equal(localEntry.isRemoteWorkspace, false);
  assert.equal(
    (localEntry.services as { zcodeTaskService: { marker: string } }).zcodeTaskService.marker,
    "local",
  );
  assert.ok(remoteEntry);
  assert.equal(remoteEntry.isRemoteWorkspace, true);
  assert.equal(
    (remoteEntry.services as { zcodeTaskService: { marker: string } }).zcodeTaskService.marker,
    "remote",
  );
});

test("collapsed workspace keys stay in their own set", () => {
  const initial = new Set(["kept", "stale"]);
  assert.equal(pruneCollapsedWorkspaceKeys(initial, ["kept", "stale", "next"]), initial);
  const pruned = pruneCollapsedWorkspaceKeys(initial, ["kept"]);
  assert.deepEqual([...pruned], ["kept"]);
  assert.equal(initial.has("stale"), true);
  const toggled = toggleCollapsedWorkspaceKey(pruned, "kept");
  assert.equal(toggled.has("kept"), false);
});

test("cross-workspace open leaves the switching flag set until failure", async () => {
  const events: string[] = [];
  await openWebRemoteIndexedTask({
    activeWorkspacePath: "/local",
    onSelectTask: () => events.push("select"),
    onSwitchingChange: (switching) => events.push(switching ? "switching" : "idle"),
    onTaskOpen: ({ crossWorkspace }) => events.push(crossWorkspace ? "cross" : "same"),
    setError: (error) => events.push(error ?? "clear-error"),
    setSwitchingTaskKey: (key) => events.push(key ?? "cleared"),
    switcher: {
      listWorkspaces: async () => ({ workspaces: [], tasks: [] }),
      switchWorkspace: async () => undefined,
    },
    task: task({
      taskId: "task-1",
      workspacePath: "/repo",
      workspaceIdentity: "remote",
    }),
  });
  assert.deepEqual(events, ["cross", "switching", "remote:task-1", "clear-error"]);

  events.length = 0;
  await openWebRemoteIndexedTask({
    activeWorkspacePath: "/local",
    onNavigateHome: () => events.push("home"),
    onSelectTask: () => events.push("select"),
    onSwitchingChange: (switching) => events.push(switching ? "switching" : "idle"),
    setError: (error) => events.push(error ?? "clear-error"),
    setSwitchingTaskKey: (key) => events.push(key ?? "cleared"),
    switcher: {
      listWorkspaces: async () => ({ workspaces: [], tasks: [] }),
      switchWorkspace: async () => {
        throw new Error("远程工作区尚未连接");
      },
    },
    task: task({ taskId: "task-1", workspacePath: "/repo", workspaceIdentity: "remote" }),
  });
  assert.deepEqual(events, [
    "switching",
    "remote:task-1",
    "clear-error",
    "cleared",
    "idle",
    "home",
  ]);
});

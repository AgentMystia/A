import assert from "node:assert/strict";
import test from "node:test";
import type { WebRemoteControlWorkspaceSnapshot, ZCodeTaskMeta } from "@zcode/shared";

import type { WindowTabState, WorkspaceTabState } from "../src/store/tabStore.js";
import { attachTaskListRowActivity } from "../src/v4/taskListRowActivity.js";
import {
  buildWebRemoteControlTaskSyncSnapshot,
  canSyncWebRemoteControlTasks,
  resolveWebRemoteControlWorkspaceSyncPayloads,
} from "../src/web-remote/sync/webRemoteControlSnapshotSync.js";

function workspaceTab(
  patch: Partial<WorkspaceTabState> & Pick<WorkspaceTabState, "workspacePath" | "label">,
): WorkspaceTabState {
  return {
    id: patch.workspacePath,
    kind: "workspace",
    ...patch,
  };
}

function task(
  patch: Partial<ZCodeTaskMeta> & Pick<ZCodeTaskMeta, "taskId" | "workspacePath">,
): ZCodeTaskMeta {
  return {
    traceId: "trace",
    title: patch.taskId,
    createdAt: 1,
    updatedAt: 1,
    mode: "act",
    ...patch,
  } as ZCodeTaskMeta;
}

test("task sync waits until pinned, timeline, and archived lists finish loading", () => {
  assert.equal(
    canSyncWebRemoteControlTasks({
      enabled: true,
      archivedLoading: false,
      pinnedLoading: false,
      timelineLoading: false,
    }),
    true,
  );
  assert.equal(
    canSyncWebRemoteControlTasks({
      enabled: true,
      archivedLoading: true,
      pinnedLoading: false,
      timelineLoading: false,
    }),
    false,
  );
  assert.equal(
    canSyncWebRemoteControlTasks({
      enabled: false,
      archivedLoading: false,
      pinnedLoading: false,
      timelineLoading: false,
    }),
    false,
  );
});

test("task snapshot keeps tab session id, phase status, and merged sort", () => {
  const tabs = [
    workspaceTab({ workspacePath: "/local", label: "local" }),
    workspaceTab({
      workspacePath: "/remote",
      label: "remote",
      workspaceIdentity: "id-remote",
      remoteSessionId: "sess-1",
    }),
  ];
  const running = attachTaskListRowActivity(
    task({
      taskId: "run",
      title: "Run",
      workspacePath: "/local",
      createdAt: 10,
      updatedAt: 10,
      provider: "glm",
    }),
    {
      phase: "running",
      lastActivityAt: 10,
      hasBackgroundWork: false,
    },
  );
  const draftStreaming = attachTaskListRowActivity(
    task({
      taskId: "draft",
      title: "Draft",
      workspacePath: "/remote",
      workspaceIdentity: "id-remote",
      createdAt: 30,
      updatedAt: 30,
      unreadAt: 4,
    }),
    {
      phase: "draft",
      lastActivityAt: 30,
      hasBackgroundWork: true,
    },
  );
  const archived = task({
    taskId: "old",
    title: "Old",
    workspacePath: "/local",
    createdAt: 5,
    updatedAt: 50,
    status: "completed",
  });
  const dropped = task({
    taskId: "gone",
    workspacePath: "/missing",
    updatedAt: 99,
  });

  const snapshot = buildWebRemoteControlTaskSyncSnapshot({
    workspaceTabs: tabs,
    workspaces: {
      "/local": { taskRuntimeByTaskId: { run: { status: "idle" } } },
      "id-remote": { taskRuntimeByTaskId: { draft: { status: "streaming" } } },
    },
    pinnedTasks: [running],
    timelineTasks: [draftStreaming, dropped],
    archivedTasks: [archived],
  });

  assert.deepEqual(
    snapshot.map((item) => item.taskId),
    ["old", "draft", "run"],
  );
  assert.equal(snapshot[0]?.archived, true);
  assert.equal(snapshot[0]?.pinned, undefined);
  assert.equal(snapshot[1]?.workspaceKind, "remote");
  assert.equal(snapshot[1]?.remoteSessionId, "sess-1");
  assert.equal(snapshot[1]?.displayStatus, "running");
  assert.equal(snapshot[1]?.hasBackgroundWork, true);
  assert.equal(snapshot[1]?.unreadAt, 4);
  assert.equal(snapshot[2]?.pinned, true);
  assert.equal(snapshot[2]?.displayStatus, "running");
  assert.equal(snapshot[2]?.provider, "glm");
  assert.equal(
    snapshot.some((item) => item.taskId === "gone"),
    false,
  );
});

test("workspace sync publishes connected remotes before the full session snapshot", () => {
  const tabs: WindowTabState[] = [
    workspaceTab({ workspacePath: "/local", label: "local" }),
    workspaceTab({
      workspacePath: "/remote",
      label: "remote",
      workspaceIdentity: "id-remote",
      remoteSessionId: "sess-1",
      workspacePurpose: "project",
    }),
    workspaceTab({
      workspacePath: "/down",
      label: "down",
      workspaceIdentity: "id-down",
    }),
    { id: "settings", kind: "settings", label: "settings" },
  ];

  const idle = resolveWebRemoteControlWorkspaceSyncPayloads({
    tabs,
    featureEnabled: true,
    sessionActive: false,
    remoteWorkspaceErrorByWorkspaceKey: { "id-down": "  refused  " },
  });
  assert.equal(idle.length, 1);
  assert.deepEqual(
    idle[0]?.map((item) => item.workspacePath),
    ["/remote"],
  );

  const active = resolveWebRemoteControlWorkspaceSyncPayloads({
    tabs,
    featureEnabled: true,
    sessionActive: true,
    reconnectingRemoteWorkspaceKeys: ["id-down"],
    remoteWorkspaceErrorByWorkspaceKey: { "id-down": "  refused  " },
  });
  assert.equal(active.length, 2);
  const full = active[1] ?? [];
  const byPath = new Map<string, WebRemoteControlWorkspaceSnapshot>(
    full.map((item) => [item.workspacePath, item]),
  );
  assert.equal(byPath.get("/local")?.kind, "local");
  assert.equal(byPath.get("/local")?.connectionState, undefined);
  assert.equal(byPath.get("/remote")?.connectionState, "connected");
  assert.equal(byPath.get("/remote")?.workspacePurpose, "project");
  assert.equal(byPath.get("/down")?.connectionState, "reconnecting");
  assert.equal(byPath.get("/down")?.lastConnectionError, "refused");
  assert.equal(
    full.some((item) => item.workspacePath === "settings"),
    false,
  );
});

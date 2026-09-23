import assert from "node:assert/strict";
import test from "node:test";
import type { BotRemoteWorkspaceReconnectedEvent, RemoteTarget } from "@zcode/shared";

import { buildRemoteWorkspaceIdentity } from "../src/lib/remoteWorkspaceHistory.js";
import { syncBotRemoteWorkspaceReconnectedUi } from "../src/root/syncBotRemoteWorkspaceReconnectedUi.js";

const target: RemoteTarget = { kind: "wsl", distro: "Ubuntu" };

function createEvent(
  overrides: Partial<BotRemoteWorkspaceReconnectedEvent> = {},
): BotRemoteWorkspaceReconnectedEvent {
  return {
    sessionId: "session-1",
    workspacePath: "/remote/repo",
    workspaceIdentity: "remote:given",
    target,
    ...overrides,
  };
}

test("bot remote reconnect ignores a disabled entry and a blank session id", async () => {
  let waited = false;
  await syncBotRemoteWorkspaceReconnectedUi({
    allowRemoteWorkspace: false,
    event: createEvent(),
    waitForRemoteWorkspaceSessionReady: async () => {
      waited = true;
    },
    getRemoteWorkspaceSession: () => null,
    resolveRemoteWorkspaceCanonicalPath: async () => "/unused",
    bindRemoteWorkspacePath: () => {},
    bindRemoteWorkspaceIdentity: () => {},
    ensureWorkspaceTab: () => {},
    remoteSessions: [],
    commitRemoteWorkspaceSessionMutation: async () => {},
    refreshPinnedTasks: async () => {},
    refreshTimelineTasks: async () => {},
  });
  await syncBotRemoteWorkspaceReconnectedUi({
    allowRemoteWorkspace: true,
    event: createEvent({ sessionId: "  " }),
    waitForRemoteWorkspaceSessionReady: async () => {
      waited = true;
    },
    getRemoteWorkspaceSession: () => null,
    resolveRemoteWorkspaceCanonicalPath: async () => "/unused",
    bindRemoteWorkspacePath: () => {},
    bindRemoteWorkspaceIdentity: () => {},
    ensureWorkspaceTab: () => {},
    remoteSessions: [],
    commitRemoteWorkspaceSessionMutation: async () => {},
    refreshPinnedTasks: async () => {},
    refreshTimelineTasks: async () => {},
  });
  assert.equal(waited, false);
});

test("bot remote reconnect reports a missing session and a missing target", async () => {
  await assert.rejects(
    syncBotRemoteWorkspaceReconnectedUi({
      allowRemoteWorkspace: true,
      event: createEvent(),
      waitForRemoteWorkspaceSessionReady: async () => {},
      getRemoteWorkspaceSession: () => null,
      resolveRemoteWorkspaceCanonicalPath: async () => "/remote/repo",
      bindRemoteWorkspacePath: () => {},
      bindRemoteWorkspaceIdentity: () => {},
      ensureWorkspaceTab: () => {},
      remoteSessions: [],
      commitRemoteWorkspaceSessionMutation: async () => {},
      refreshPinnedTasks: async () => {},
      refreshTimelineTasks: async () => {},
    }),
    /远程 workspace session 不存在: session-1/,
  );
  await assert.rejects(
    syncBotRemoteWorkspaceReconnectedUi({
      allowRemoteWorkspace: true,
      event: createEvent(),
      waitForRemoteWorkspaceSessionReady: async () => {},
      getRemoteWorkspaceSession: () => ({}),
      resolveRemoteWorkspaceCanonicalPath: async () => "/remote/repo",
      bindRemoteWorkspacePath: () => {},
      bindRemoteWorkspaceIdentity: () => {},
      ensureWorkspaceTab: () => {},
      remoteSessions: [],
      commitRemoteWorkspaceSessionMutation: async () => {},
      refreshPinnedTasks: async () => {},
      refreshTimelineTasks: async () => {},
    }),
    /远程 workspace session 缺少连接目标: session-1/,
  );
});

test("bot remote reconnect binds the event identity and refreshes task lists", async () => {
  const calls: string[] = [];
  let committedIdentity = "";
  await syncBotRemoteWorkspaceReconnectedUi({
    allowRemoteWorkspace: true,
    event: createEvent({ sessionId: " session-1 " }),
    waitForRemoteWorkspaceSessionReady: async (sessionId) => {
      calls.push(`wait:${sessionId}`);
    },
    getRemoteWorkspaceSession: () => ({ target }),
    resolveRemoteWorkspaceCanonicalPath: async (_sessionId, workspacePath) => `${workspacePath}/canon`,
    bindRemoteWorkspacePath: (workspacePath, sessionId) => {
      calls.push(`path:${workspacePath}:${sessionId}`);
    },
    bindRemoteWorkspaceIdentity: (workspaceIdentity, sessionId) => {
      calls.push(`identity:${workspaceIdentity}:${sessionId}`);
    },
    ensureWorkspaceTab: (workspacePath, options) => {
      calls.push(
        `tab:${workspacePath}:${options.remoteSessionId}:${options.workspaceIdentity}:${options.remoteTarget.kind}`,
      );
    },
    remoteSessions: [],
    commitRemoteWorkspaceSessionMutation: async (mutation) => {
      committedIdentity = mutation.entry.workspaceIdentity ?? "";
      calls.push(
        `commit:${mutation.entry.workspacePath}:${mutation.entry.lastConnectionStatus}:${mutation.entry.workspaceIdentity}`,
      );
    },
    refreshPinnedTasks: async (input) => {
      calls.push(`pinned:${input.workspaceIdentity}`);
    },
    refreshTimelineTasks: async (input) => {
      calls.push(`timeline:${input.workspaceIdentity}`);
    },
  });
  assert.deepEqual(calls, [
    "wait:session-1",
    "path:/remote/repo/canon:session-1",
    "identity:remote:given:session-1",
    "tab:/remote/repo/canon:session-1:remote:given:wsl",
    "commit:/remote/repo/canon:connected:remote:given",
    "pinned:remote:given",
    "timeline:remote:given",
  ]);
  assert.equal(committedIdentity, "remote:given");
});

test("bot remote reconnect derives identity when the event identity is blank", async () => {
  let identity = "";
  await syncBotRemoteWorkspaceReconnectedUi({
    allowRemoteWorkspace: true,
    event: createEvent({ workspaceIdentity: "  " }),
    waitForRemoteWorkspaceSessionReady: async () => {},
    getRemoteWorkspaceSession: () => ({ target }),
    resolveRemoteWorkspaceCanonicalPath: async () => "/remote/repo",
    bindRemoteWorkspacePath: () => {},
    bindRemoteWorkspaceIdentity: (workspaceIdentity) => {
      identity = workspaceIdentity;
    },
    ensureWorkspaceTab: () => {},
    remoteSessions: [],
    commitRemoteWorkspaceSessionMutation: async () => {},
    refreshPinnedTasks: async () => {},
    refreshTimelineTasks: async () => {},
  });
  assert.equal(identity, buildRemoteWorkspaceIdentity("/remote/repo", target));
});

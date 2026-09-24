import type {
  BotRemoteWorkspaceReconnectedEvent,
  RemoteTarget,
  RemoteWorkspaceSessionEntry,
} from "@zcode/shared";
import {
  buildRemoteWorkspaceIdentity,
  buildRemoteWorkspaceSessionMutation,
} from "@/lib/remoteWorkspaceHistory.js";

interface BotRemoteWorkspaceSession {
  target?: RemoteTarget;
}

export async function syncBotRemoteWorkspaceReconnectedUi(params: {
  allowRemoteWorkspace: boolean;
  event: BotRemoteWorkspaceReconnectedEvent;
  waitForRemoteWorkspaceSessionReady: (sessionId: string) => Promise<void>;
  getRemoteWorkspaceSession: (sessionId: string) => BotRemoteWorkspaceSession | null;
  resolveRemoteWorkspaceCanonicalPath: (
    sessionId: string,
    workspacePath: string,
  ) => Promise<string>;
  bindRemoteWorkspacePath: (workspacePath: string, sessionId: string) => void;
  bindRemoteWorkspaceIdentity: (workspaceIdentity: string, sessionId: string) => void;
  ensureWorkspaceTab: (
    workspacePath: string,
    options: {
      remoteSessionId: string;
      remoteTarget: RemoteTarget;
      workspaceIdentity: string;
    },
  ) => void;
  remoteSessions: RemoteWorkspaceSessionEntry[];
  commitRemoteWorkspaceSessionMutation: (
    mutation: ReturnType<typeof buildRemoteWorkspaceSessionMutation>,
  ) => Promise<unknown>;
  refreshPinnedTasks: (input: {
    sessionId: string;
    workspacePath: string;
    workspaceIdentity: string;
  }) => Promise<void>;
  refreshTimelineTasks: (input: {
    sessionId: string;
    workspacePath: string;
    workspaceIdentity: string;
  }) => Promise<void>;
}): Promise<void> {
  if (!params.allowRemoteWorkspace) {
    return;
  }

  const sessionId = params.event.sessionId.trim();
  if (!sessionId) {
    return;
  }

  // 重连成功事件可能先于 renderer store 注册到达。沿用连接流程的等待，不另建 session。
  await params.waitForRemoteWorkspaceSessionReady(sessionId);
  const session = params.getRemoteWorkspaceSession(sessionId);
  if (!session) {
    throw new Error(`远程 workspace session 不存在: ${sessionId}`);
  }
  if (!session.target) {
    throw new Error(`远程 workspace session 缺少连接目标: ${sessionId}`);
  }

  const resolvedWorkspacePath = await params.resolveRemoteWorkspaceCanonicalPath(
    sessionId,
    params.event.workspacePath,
  );
  const workspaceIdentity =
    params.event.workspaceIdentity.trim() ||
    buildRemoteWorkspaceIdentity(resolvedWorkspacePath, session.target);
  params.bindRemoteWorkspacePath(resolvedWorkspacePath, sessionId);
  params.bindRemoteWorkspaceIdentity(workspaceIdentity, sessionId);
  params.ensureWorkspaceTab(resolvedWorkspacePath, {
    remoteSessionId: sessionId,
    remoteTarget: session.target,
    workspaceIdentity,
  });
  await params.commitRemoteWorkspaceSessionMutation(
    buildRemoteWorkspaceSessionMutation({
      remoteSessions: params.remoteSessions,
      workspacePath: resolvedWorkspacePath,
      workspaceIdentity,
      target: session.target,
      lastConnectionStatus: "connected",
      touchOpenedAt: true,
    }),
  );
  await Promise.all([
    params.refreshPinnedTasks({
      sessionId,
      workspacePath: resolvedWorkspacePath,
      workspaceIdentity,
    }),
    params.refreshTimelineTasks({
      sessionId,
      workspacePath: resolvedWorkspacePath,
      workspaceIdentity,
    }),
  ]);
}

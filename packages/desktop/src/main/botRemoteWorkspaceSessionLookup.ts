import { resolveWorkspaceKey, type RemoteTarget } from "@zcode/shared";
import { isSameRemoteTarget } from "./remoteTargetEquality.js";

export const BOT_REMOTE_WORKSPACE_RUNTIME_SESSION_MISSING =
  "未找到可供 Bot attachment 的远端 logical session";

export interface BotRemoteAttachmentRouteSnapshot {
  webContentsId: number;
  attachmentState: "attachable" | "closed";
  descriptor: {
    workspacePath?: string;
    workspaceIdentity?: string;
    target: RemoteTarget;
  };
}

export interface BotRemoteWorkspaceLookupRequest {
  workspacePath: string;
  workspaceIdentity: string;
  target: RemoteTarget;
}

export function hasRemoteWorkspaceSessionForTarget(
  routes: { values(): Iterable<BotRemoteAttachmentRouteSnapshot> },
  webContentsId: number,
  target: RemoteTarget,
  workspace?: { workspacePath: string; workspaceIdentity?: string },
): boolean {
  const expected = workspace ? resolveWorkspaceKey(workspace) : undefined;
  for (const route of routes.values()) {
    if (route.webContentsId !== webContentsId || route.attachmentState !== "attachable") {
      continue;
    }
    if (!isSameRemoteTarget(route.descriptor.target, target)) continue;
    if (
      !expected ||
      resolveWorkspaceKey({
        workspacePath: route.descriptor.workspacePath ?? "",
        workspaceIdentity: route.descriptor.workspaceIdentity,
      }) === expected
    ) {
      return true;
    }
  }
  return false;
}

/** 重连与 runtime 要求 path、identity 原文相等，不用 resolveWorkspaceKey。 */
export function findAttachableBotRemoteSessionId(
  routes: { entries(): Iterable<[string, BotRemoteAttachmentRouteSnapshot]> },
  webContentsId: number,
  request: BotRemoteWorkspaceLookupRequest,
): string | undefined {
  for (const [sessionId, route] of routes.entries()) {
    if (
      route.webContentsId === webContentsId &&
      route.attachmentState === "attachable" &&
      route.descriptor.workspacePath === request.workspacePath &&
      route.descriptor.workspaceIdentity === request.workspaceIdentity &&
      isSameRemoteTarget(route.descriptor.target, request.target)
    ) {
      return sessionId;
    }
  }
  return undefined;
}

export function requireBotRemoteWorkspaceSessionId(
  routes: { entries(): Iterable<[string, BotRemoteAttachmentRouteSnapshot]> },
  webContentsId: number,
  request: BotRemoteWorkspaceLookupRequest,
): string {
  const sessionId = findAttachableBotRemoteSessionId(routes, webContentsId, request);
  if (!sessionId) {
    throw new Error(BOT_REMOTE_WORKSPACE_RUNTIME_SESSION_MISSING);
  }
  return sessionId;
}

/**
 * 发布包重连 admission。in-flight 由 session manager 持有，键不含 requestId。
 * createSession 在写入 map 之前调用，与发布包 `J` 然后 `n.set` 的顺序一致。
 */
export function admitBotRemoteWorkspaceReconnect(params: {
  routes: { entries(): Iterable<[string, BotRemoteAttachmentRouteSnapshot]> };
  inFlight: Map<string, Promise<string>>;
  webContentsId: number;
  request: BotRemoteWorkspaceLookupRequest & { requestId: string };
  createSession: () => Promise<string>;
}): Promise<string> {
  const existing = findAttachableBotRemoteSessionId(
    params.routes,
    params.webContentsId,
    params.request,
  );
  if (existing) return Promise.resolve(existing);
  const key = `${params.webContentsId}\0${params.request.workspaceIdentity}`;
  const pending = params.inFlight.get(key);
  if (pending) return pending;
  const created = params.createSession();
  params.inFlight.set(key, created);
  void created.finally(() => {
    if (params.inFlight.get(key) === created) {
      params.inFlight.delete(key);
    }
  });
  return created;
}

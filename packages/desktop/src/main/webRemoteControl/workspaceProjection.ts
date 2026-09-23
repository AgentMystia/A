import { resolveWorkspaceKey } from "@zcode/shared";
import type {
  WebRemoteControlTaskSnapshot,
  WebRemoteControlWorkspaceSnapshot,
} from "@zcode/shared";
import type {
  WebRemoteControlBridge,
  WebRemoteControlMobileView,
  WebRemoteControlRuntime,
} from "./runtimeTypes.js";

export function webRemoteControlPathLabel(workspacePath: string): string {
  const parts = workspacePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? workspacePath;
}

export function resolveWebRemoteControlWorkspaceKey(target: {
  workspacePath: string;
  workspaceIdentity?: string;
}): string {
  return resolveWorkspaceKey(target);
}

export function isBridgeableRemoteWorkspace(target: {
  kind: "local" | "remote";
  workspaceIdentity?: string;
  remoteSessionId?: string;
}): boolean {
  return target.kind !== "remote" || !!(target.workspaceIdentity && target.remoteSessionId);
}

export function isBridgeableRemoteTask(task: WebRemoteControlTaskSnapshot): boolean {
  return task.workspaceKind !== "remote" || !!(task.workspaceIdentity && task.remoteSessionId);
}

export function getRuntimeWorkspaceTarget(
  runtime: WebRemoteControlRuntime,
): WebRemoteControlWorkspaceSnapshot {
  const bridge = runtime.currentBridge;
  if (bridge) {
    return {
      workspacePath: bridge.workspacePath,
      workspaceIdentity: bridge.workspaceIdentity,
      remoteSessionId: bridge.remoteSessionId,
      label: webRemoteControlPathLabel(bridge.workspacePath),
      kind: bridge.kind,
    };
  }
  return getRuntimeStatusTarget(runtime);
}

export function getRuntimeStatusTarget(
  runtime: WebRemoteControlRuntime,
): WebRemoteControlWorkspaceSnapshot {
  return {
    workspacePath: runtime.workspacePath,
    workspaceIdentity: runtime.workspaceIdentity,
    remoteSessionId: runtime.remoteSessionId,
    label: webRemoteControlPathLabel(runtime.workspacePath),
    kind: runtime.remoteSessionId || runtime.workspaceIdentity ? "remote" : "local",
  };
}

export function getAvailableWorkspaces(
  runtime: WebRemoteControlRuntime,
  synced: readonly WebRemoteControlWorkspaceSnapshot[],
): WebRemoteControlWorkspaceSnapshot[] {
  const byKey = new Map<string, WebRemoteControlWorkspaceSnapshot>();
  for (const workspace of synced)
    byKey.set(resolveWebRemoteControlWorkspaceKey(workspace), workspace);
  const current = getRuntimeWorkspaceTarget(runtime);
  if (isBridgeableRemoteWorkspace(current)) {
    const key = resolveWebRemoteControlWorkspaceKey(current);
    if (!byKey.has(key)) byKey.set(key, current);
  }
  return [...byKey.values()];
}

export function getAvailableTasks(
  runtime: WebRemoteControlRuntime,
  syncedWorkspaces: readonly WebRemoteControlWorkspaceSnapshot[],
  syncedTasks: readonly WebRemoteControlTaskSnapshot[],
): WebRemoteControlTaskSnapshot[] {
  const keys = new Set(
    getAvailableWorkspaces(runtime, syncedWorkspaces).map(resolveWebRemoteControlWorkspaceKey),
  );
  return syncedTasks
    .filter(
      (task) => isBridgeableRemoteTask(task) && keys.has(resolveWebRemoteControlWorkspaceKey(task)),
    )
    .toSorted((left, right) =>
      right.updatedAt !== left.updatedAt
        ? right.updatedAt - left.updatedAt
        : right.createdAt !== left.createdAt
          ? right.createdAt - left.createdAt
          : right.taskId.localeCompare(left.taskId),
    );
}

export function getRuntimeInitialViewState(
  runtime: WebRemoteControlRuntime,
): WebRemoteControlMobileView | undefined {
  const current = getRuntimeWorkspaceTarget(runtime);
  if (!runtime.initialTaskId || !isBridgeableRemoteWorkspace(current)) return undefined;
  return {
    activeWorkspaceKey: resolveWebRemoteControlWorkspaceKey(current),
    activeTaskId: runtime.initialTaskId,
    updatedAt: Date.now(),
  };
}

export function buildWorkspaceListPushSignature(input: {
  workspaces: readonly WebRemoteControlWorkspaceSnapshot[];
  tasks: readonly WebRemoteControlTaskSnapshot[];
}): string {
  const workspaces = input.workspaces
    .map((workspace) =>
      JSON.stringify([
        resolveWebRemoteControlWorkspaceKey(workspace),
        workspace.kind,
        workspace.connectionState ?? "connected",
        workspace.remoteSessionId ?? "",
        workspace.lastConnectionError ?? "",
      ]),
    )
    .toSorted();
  const tasks = input.tasks
    .map((task) =>
      JSON.stringify([
        resolveWebRemoteControlWorkspaceKey(task),
        task.taskId,
        task.title,
        task.remoteSessionId ?? "",
        task.displayStatus ?? "idle",
        !!task.hasBackgroundWork,
        task.workflowActivity ?? null,
        typeof task.unreadAt === "number" ? task.unreadAt : "",
        !!task.pinned,
        !!task.archived,
      ]),
    )
    .toSorted();
  return JSON.stringify([workspaces, tasks]);
}

export function bridgeIdentityFields(bridge: {
  bridgeSessionId: string;
  bridgeGeneration?: number;
  recoveryId?: string;
}): {
  bridgeSessionId: string;
  bridgeGeneration?: number;
  recoveryId?: string;
} {
  return {
    bridgeSessionId: bridge.bridgeSessionId,
    ...(bridge.bridgeGeneration === undefined ? {} : { bridgeGeneration: bridge.bridgeGeneration }),
    ...(bridge.recoveryId ? { recoveryId: bridge.recoveryId } : {}),
  };
}

export function toExternalBridge(bridge: WebRemoteControlBridge): Record<string, unknown> {
  const common = {
    ...bridgeIdentityFields(bridge),
    workspaceKey: bridge.workspaceKey,
    workspacePath: bridge.workspacePath,
    initialTaskId: bridge.initialTaskId,
  };
  if (bridge.kind === "remote") {
    if (!bridge.workspaceIdentity || !bridge.remoteSessionId) {
      throw new Error("远程 workspace bridge 缺少 workspaceIdentity 或 remoteSessionId。");
    }
    return {
      ...common,
      kind: "remote",
      workspaceIdentity: bridge.workspaceIdentity,
      remoteSessionId: bridge.remoteSessionId,
    };
  }
  return { ...common, kind: "local" };
}

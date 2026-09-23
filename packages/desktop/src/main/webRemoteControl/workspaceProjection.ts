import type {
  WebRemoteControlTaskSnapshot,
  WebRemoteControlWorkspaceSnapshot,
} from "@zcode/shared";
import { resolveWebRemoteControlWorkspaceKey } from "@zcode/shared";
import type {
  WebRemoteControlBridge,
  WebRemoteControlMobileView,
  WebRemoteControlRuntime,
} from "./runtimeTypes.js";

export { resolveWebRemoteControlWorkspaceKey };

export function getPathLabel(workspacePath: string): string {
  const parts = workspacePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? workspacePath;
}

export { getPathLabel as webRemoteControlPathLabel };

export function isBridgeableRemoteTarget(target: {
  kind: "local" | "remote";
  workspaceIdentity?: string;
  remoteSessionId?: string;
}): boolean {
  return target.kind !== "remote" || !!(target.workspaceIdentity && target.remoteSessionId);
}

export { isBridgeableRemoteTarget as isBridgeableRemoteWorkspace };

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
      label: getPathLabel(bridge.workspacePath),
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
    label: getPathLabel(runtime.workspacePath),
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
  if (isBridgeableRemoteTarget(current)) {
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
  if (!runtime.initialTaskId || !isBridgeableRemoteTarget(current)) return undefined;
  return {
    activeWorkspaceKey: resolveWebRemoteControlWorkspaceKey(current),
    activeTaskId: runtime.initialTaskId,
    updatedAt: Date.now(),
  };
}

// 发布包 main 的 bootstrap 结果是具名函数。内联在 switch 里不会留下 buildBootstrapResult。
export function buildBootstrapResult(input: {
  runtime: WebRemoteControlRuntime;
  appVersion?: string;
  workspaces: readonly WebRemoteControlWorkspaceSnapshot[];
  tasks: readonly WebRemoteControlTaskSnapshot[];
}): {
  windowControlSessionId: string;
  desktopAppVersion?: string;
  workspaces: WebRemoteControlWorkspaceSnapshot[];
  tasks: WebRemoteControlTaskSnapshot[];
  initialViewState: WebRemoteControlMobileView | undefined;
  mobileViewState: WebRemoteControlMobileView | undefined;
} {
  const { runtime } = input;
  return {
    windowControlSessionId: runtime.deviceSid,
    desktopAppVersion: input.appVersion,
    workspaces: getAvailableWorkspaces(runtime, input.workspaces),
    tasks: getAvailableTasks(runtime, input.workspaces, input.tasks),
    initialViewState: getRuntimeInitialViewState(runtime),
    mobileViewState: runtime.mobileViewState,
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

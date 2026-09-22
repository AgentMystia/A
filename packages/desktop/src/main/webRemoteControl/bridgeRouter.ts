import {
  buildWebRemoteControlPairResultTelemetry,
  parseRemoteWorkspaceIdentity,
  type WebRemoteControlTaskSnapshot,
  type WebRemoteControlWorkspaceSnapshot,
} from "@zcode/shared";
import {
  clearMobileDisconnectGrace,
  clearPendingOutboundTimer,
  flushPendingOutboundPayloads,
  sendAppPayload,
} from "./outboundBuffer.js";
import {
  createWebRemoteControlFailure,
  WEB_REMOTE_CONTROL_MOBILE_DISCONNECT_GRACE_MS,
  type WebRemoteControlBridge,
  type WebRemoteControlManagerDependencies,
  type WebRemoteControlRuntime,
} from "./runtimeTypes.js";
import {
  availableTasks,
  availableWorkspaces,
  bridgeIdentityFields,
  runtimeInitialViewState,
  runtimeStatusTarget,
  runtimeWorkspaceTarget,
  webRemoteControlWorkspaceKey,
  workspaceListSignature,
} from "./workspaceProjection.js";

export interface BridgeRouterState {
  runtimes: Map<number, WebRemoteControlRuntime>;
  workspaces: Map<number, readonly WebRemoteControlWorkspaceSnapshot[]>;
  tasks: Map<number, readonly WebRemoteControlTaskSnapshot[]>;
  signatures: Map<number, string>;
}

export function reportUsage(
  deps: WebRemoteControlManagerDependencies,
  windowId: number,
  event: Parameters<NonNullable<WebRemoteControlManagerDependencies["reportRemoteUsageEvent"]>>[1],
): void {
  try {
    deps.reportRemoteUsageEvent?.(windowId, event);
  } catch (error) {
    deps.logger.warn("[web-remote-control] remote usage telemetry failed", {
      elementName: event.elementName,
      error,
    });
  }
}

export function publishRuntimeStatus(
  deps: WebRemoteControlManagerDependencies,
  runtime: WebRemoteControlRuntime,
): void {
  const target = runtimeStatusTarget(runtime);
  deps.onStatusChanged?.(runtime.windowId, {
    status: runtime.status,
    sessionId: runtime.deviceSid,
    windowControlSessionId: runtime.deviceSid,
    mobileConnected: runtime.mobileConnected,
    mobileViewState: runtime.mobileViewState,
    mobileDeviceInfo: runtime.mobileDeviceInfo,
    qrUrl: runtime.qrUrl,
    connectUrl: runtime.connectUrl,
    workspacePath: target.workspacePath,
    workspaceIdentity: target.workspaceIdentity,
    remoteSessionId: target.remoteSessionId,
    initialTaskId: runtime.currentBridge?.initialTaskId ?? runtime.initialTaskId,
    error: runtime.error,
    failure: runtime.failure,
  });
}

export function disposeRuntimeBridge(
  deps: WebRemoteControlManagerDependencies,
  runtime: WebRemoteControlRuntime,
): void {
  const bridge = runtime.currentBridge;
  if (!bridge) return;
  bridge.disposeBridge?.();
  bridge.disposeBridge = undefined;
  bridge.relayProtocol?.dispose();
  bridge.relayProtocol = undefined;
  try {
    bridge.hostProtocol?.disconnect();
  } catch {
    // 端口可能已经随 Host 退出关闭。
  }
  if (bridge.attachmentId) deps.releaseWorkspaceHostAttachment(bridge.attachmentId);
  runtime.currentBridge = undefined;
}

export function isCurrentBridge(
  state: BridgeRouterState,
  runtime: WebRemoteControlRuntime,
  bridge: WebRemoteControlBridge,
): boolean {
  return state.runtimes.get(runtime.windowId) === runtime && runtime.currentBridge === bridge;
}

export function degradeBridge(
  deps: WebRemoteControlManagerDependencies,
  state: BridgeRouterState,
  runtime: WebRemoteControlRuntime,
  bridge: WebRemoteControlBridge,
  reasonCode: string,
): void {
  if (!isCurrentBridge(state, runtime, bridge) || bridge.degraded) return;
  bridge.degraded = true;
  deps.logger.warn("[web-remote-control] raw relay bridge degraded", {
    windowId: runtime.windowId,
    session: runtime.deviceSid,
    bridgeSessionId: bridge.bridgeSessionId,
    bridgeGeneration: bridge.bridgeGeneration,
    recoveryId: bridge.recoveryId,
    reasonCode,
  });
  sendAppPayload(
    runtime,
    {
      zcode_type: "bridge-degraded",
      ...bridgeIdentityFields(bridge),
      reason: "rpc-transport-fault",
    },
    deps.logger,
  );
}

export function preserveWindowRuntimeFailure(
  deps: WebRemoteControlManagerDependencies,
  state: BridgeRouterState,
  windowId: number,
  runtime: WebRemoteControlRuntime,
  reason: string,
  failure: { reason: string; message: string },
): void {
  if (runtime.status === "error" && runtime.failure?.reason === failure.reason) return;
  sendAppPayload(
    runtime,
    {
      zcode_type: "app-error",
      reason: failure.reason,
      error: failure.message ?? failure.reason,
    },
    deps.logger,
  );
  disposeRuntimeBridge(deps, runtime);
  clearPendingOutboundTimer(runtime);
  clearMobileDisconnectGrace(runtime);
  runtime.pendingOutboundPayloads.length = 0;
  runtime.transport.dispose();
  runtime.status = "error";
  runtime.error = failure.message;
  runtime.failure = failure;
  state.runtimes.set(windowId, runtime);
  deps.logger.warn(
    `[web-remote-control] runtime closed window=${windowId} session=${runtime.deviceSid} reason=${reason} failure=${failure.reason} message=${failure.message ?? "<none>"}`,
  );
  publishRuntimeStatus(deps, runtime);
}

function scheduleMobileDisconnectGrace(
  deps: WebRemoteControlManagerDependencies,
  state: BridgeRouterState,
  runtime: WebRemoteControlRuntime,
): void {
  if (runtime.mobileDisconnectGraceTimer) return;
  runtime.mobileDisconnectGraceTimer = setTimeout(() => {
    runtime.mobileDisconnectGraceTimer = undefined;
    if (state.runtimes.get(runtime.windowId) !== runtime || runtime.status === "error") return;
    runtime.status = "running";
    runtime.mobileConnected = false;
    publishRuntimeStatus(deps, runtime);
  }, WEB_REMOTE_CONTROL_MOBILE_DISCONNECT_GRACE_MS);
}

function workspaceDimensions(runtime: WebRemoteControlRuntime): {
  workspaceKind: string;
  remoteKind?: string;
} {
  const identity = runtime.workspaceIdentity
    ? parseRemoteWorkspaceIdentity(runtime.workspaceIdentity)?.kind
    : undefined;
  return {
    workspaceKind:
      runtime.workspaceIdentity?.trim() || runtime.remoteSessionId ? "remote" : "local",
    remoteKind: identity,
  };
}

export function mapTransportState(
  deps: WebRemoteControlManagerDependencies,
  state: BridgeRouterState,
  runtime: WebRemoteControlRuntime,
  next: NonNullable<WebRemoteControlRuntime["transportState"]>,
): void {
  const previous = runtime.transportState;
  runtime.transportState = next;
  if (next === "connecting" || next === "registering" || next === "authenticating") {
    if (runtime.mobileConnected) {
      runtime.status = "active";
      scheduleMobileDisconnectGrace(deps, state, runtime);
      publishRuntimeStatus(deps, runtime);
      return;
    }
    runtime.status = "starting";
    publishRuntimeStatus(deps, runtime);
    return;
  }
  if (next === "waiting_terminal") {
    if (runtime.mobileConnected) {
      runtime.status = "active";
      scheduleMobileDisconnectGrace(deps, state, runtime);
      publishRuntimeStatus(deps, runtime);
      return;
    }
    runtime.status = "running";
    runtime.mobileConnected = false;
    publishRuntimeStatus(deps, runtime);
    return;
  }
  if (next === "paired") {
    if (previous !== "paired") {
      reportUsage(
        deps,
        runtime.windowId,
        buildWebRemoteControlPairResultTelemetry({
          result: "success",
          pairKind: runtime.hasEverPaired ? "reconnect" : "initial",
          ...workspaceDimensions(runtime),
        }),
      );
    }
    runtime.hasEverPaired = true;
    clearMobileDisconnectGrace(runtime);
    runtime.status = "active";
    runtime.mobileConnected = true;
    publishRuntimeStatus(deps, runtime);
    flushPendingOutboundPayloads(runtime, deps.logger);
    return;
  }
  if (next === "kicked") {
    if (previous !== "kicked") {
      reportUsage(
        deps,
        runtime.windowId,
        buildWebRemoteControlPairResultTelemetry({
          result: "failure",
          pairKind: runtime.hasEverPaired ? "reconnect" : "initial",
          ...workspaceDimensions(runtime),
          errorCategory: "relay",
        }),
      );
    }
    preserveWindowRuntimeFailure(
      deps,
      state,
      runtime.windowId,
      runtime,
      "external-relay-kicked",
      createWebRemoteControlFailure(
        "session-conflict",
        "Web remote control connection was kicked by relay.",
      ),
    );
    return;
  }
  if (next === "error") {
    if (previous !== "error") {
      reportUsage(
        deps,
        runtime.windowId,
        buildWebRemoteControlPairResultTelemetry({
          result: "failure",
          pairKind: runtime.hasEverPaired ? "reconnect" : "initial",
          ...workspaceDimensions(runtime),
          errorCategory: "relay",
        }),
      );
    }
    runtime.status = "error";
    publishRuntimeStatus(deps, runtime);
  }
}

export function listResult(state: BridgeRouterState, runtime: WebRemoteControlRuntime) {
  const current = runtimeWorkspaceTarget(runtime);
  const initial = runtimeInitialViewState(runtime);
  const workspaces = availableWorkspaces(runtime, state.workspaces.get(runtime.windowId) ?? []);
  const tasks = availableTasks(
    runtime,
    state.workspaces.get(runtime.windowId) ?? [],
    state.tasks.get(runtime.windowId) ?? [],
  );
  return {
    workspaces,
    tasks,
    activeWorkspaceKey:
      runtime.mobileViewState?.activeWorkspaceKey ??
      initial?.activeWorkspaceKey ??
      webRemoteControlWorkspaceKey(current),
    activeTaskId:
      runtime.mobileViewState?.activeTaskId ??
      runtime.currentBridge?.initialTaskId ??
      initial?.activeTaskId,
  };
}

function pushWorkspaceList(
  deps: WebRemoteControlManagerDependencies,
  state: BridgeRouterState,
  runtime: WebRemoteControlRuntime,
): void {
  const result = listResult(state, runtime);
  const signature = workspaceListSignature(result);
  if (state.signatures.get(runtime.windowId) === signature) return;
  state.signatures.set(runtime.windowId, signature);
  sendAppPayload(runtime, { zcode_type: "workspace-list-updated", result }, deps.logger);
}

export function pushWorkspaceListUpdated(
  deps: WebRemoteControlManagerDependencies,
  state: BridgeRouterState,
  runtime: WebRemoteControlRuntime,
): void {
  pushWorkspaceList(deps, state, runtime);
}

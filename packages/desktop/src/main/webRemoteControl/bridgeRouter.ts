import {
  buildWebRemoteControlPairResultTelemetry,
  parseRemoteWorkspaceIdentity,
  type WebRemoteControlTaskSnapshot,
  type WebRemoteControlWorkspaceSnapshot,
} from "@zcode/shared";
import {
  clearMobileDisconnectGraceTimer,
  clearPendingOutboundPayloadTimer,
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
  getAvailableTasks,
  getAvailableWorkspaces,
  bridgeIdentityFields,
  getRuntimeInitialViewState,
  getRuntimeStatusTarget,
  getRuntimeWorkspaceTarget,
  resolveWebRemoteControlWorkspaceKey,
  buildWorkspaceListPushSignature,
} from "./workspaceProjection.js";

export interface BridgeRouterState {
  runtimes: Map<number, WebRemoteControlRuntime>;
  workspaces: Map<number, readonly WebRemoteControlWorkspaceSnapshot[]>;
  tasks: Map<number, readonly WebRemoteControlTaskSnapshot[]>;
  signatures: Map<number, string>;
}

export function reportRemoteUsageEvent(
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

// 发布包把状态对象和通知拆成两个 keepName。emit 只把 build 的结果交给 onStatusChanged。
export function buildRuntimeStatus(runtime: WebRemoteControlRuntime) {
  const target = getRuntimeStatusTarget(runtime);
  return {
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
  };
}

export function emitRuntimeStatus(
  deps: WebRemoteControlManagerDependencies,
  runtime: WebRemoteControlRuntime,
): void {
  deps.onStatusChanged?.(runtime.windowId, buildRuntimeStatus(runtime));
}

export function disposeRuntimeBridgeResources(
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

export function isCurrentBridgeRuntime(
  state: BridgeRouterState,
  runtime: WebRemoteControlRuntime,
  bridge: WebRemoteControlBridge,
): boolean {
  return state.runtimes.get(runtime.windowId) === runtime && runtime.currentBridge === bridge;
}

export function degradeBridgeAfterRawFault(
  deps: WebRemoteControlManagerDependencies,
  state: BridgeRouterState,
  runtime: WebRemoteControlRuntime,
  bridge: WebRemoteControlBridge,
  reasonCode: string,
): void {
  if (!isCurrentBridgeRuntime(state, runtime, bridge) || bridge.degraded) return;
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
  disposeRuntimeBridgeResources(deps, runtime);
  clearPendingOutboundPayloadTimer(runtime);
  clearMobileDisconnectGraceTimer(runtime);
  runtime.pendingOutboundPayloads.length = 0;
  runtime.transport.dispose();
  runtime.status = "error";
  runtime.error = failure.message;
  runtime.failure = failure;
  state.runtimes.set(windowId, runtime);
  deps.logger.warn(
    `[web-remote-control] runtime closed window=${windowId} session=${runtime.deviceSid} reason=${reason} failure=${failure.reason} message=${failure.message ?? "<none>"}`,
  );
  emitRuntimeStatus(deps, runtime);
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
    emitRuntimeStatus(deps, runtime);
  }, WEB_REMOTE_CONTROL_MOBILE_DISCONNECT_GRACE_MS);
}

export function resolveRemoteKind(
  target: { kind: "local" | "remote"; workspaceIdentity?: string },
  attached?: { remoteKind?: string },
): string | undefined {
  // 发布包只在 remote workspace 上取 kind；本地 workspace 落到函数末尾，得到 undefined。
  if (target.kind === "remote") {
    return (
      attached?.remoteKind ??
      (target.workspaceIdentity
        ? parseRemoteWorkspaceIdentity(target.workspaceIdentity)?.kind
        : undefined)
    );
  }
}

function resolveRuntimeWorkspaceDimensions(runtime: WebRemoteControlRuntime): {
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
      emitRuntimeStatus(deps, runtime);
      return;
    }
    runtime.status = "starting";
    emitRuntimeStatus(deps, runtime);
    return;
  }
  if (next === "waiting_terminal") {
    if (runtime.mobileConnected) {
      runtime.status = "active";
      scheduleMobileDisconnectGrace(deps, state, runtime);
      emitRuntimeStatus(deps, runtime);
      return;
    }
    runtime.status = "running";
    runtime.mobileConnected = false;
    emitRuntimeStatus(deps, runtime);
    return;
  }
  if (next === "paired") {
    if (previous !== "paired") {
      reportRemoteUsageEvent(
        deps,
        runtime.windowId,
        buildWebRemoteControlPairResultTelemetry({
          result: "success",
          pairKind: runtime.hasEverPaired ? "reconnect" : "initial",
          ...resolveRuntimeWorkspaceDimensions(runtime),
        }),
      );
    }
    runtime.hasEverPaired = true;
    clearMobileDisconnectGraceTimer(runtime);
    runtime.status = "active";
    runtime.mobileConnected = true;
    emitRuntimeStatus(deps, runtime);
    flushPendingOutboundPayloads(runtime, deps.logger);
    return;
  }
  if (next === "kicked") {
    if (previous !== "kicked") {
      reportRemoteUsageEvent(
        deps,
        runtime.windowId,
        buildWebRemoteControlPairResultTelemetry({
          result: "failure",
          pairKind: runtime.hasEverPaired ? "reconnect" : "initial",
          ...resolveRuntimeWorkspaceDimensions(runtime),
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
      reportRemoteUsageEvent(
        deps,
        runtime.windowId,
        buildWebRemoteControlPairResultTelemetry({
          result: "failure",
          pairKind: runtime.hasEverPaired ? "reconnect" : "initial",
          ...resolveRuntimeWorkspaceDimensions(runtime),
          errorCategory: "relay",
        }),
      );
    }
    runtime.status = "error";
    emitRuntimeStatus(deps, runtime);
  }
}

export function buildWorkspaceListResult(
  state: BridgeRouterState,
  runtime: WebRemoteControlRuntime,
) {
  const current = getRuntimeWorkspaceTarget(runtime);
  const initial = getRuntimeInitialViewState(runtime);
  const workspaces = getAvailableWorkspaces(runtime, state.workspaces.get(runtime.windowId) ?? []);
  const tasks = getAvailableTasks(
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
      resolveWebRemoteControlWorkspaceKey(current),
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
  const result = buildWorkspaceListResult(state, runtime);
  const signature = buildWorkspaceListPushSignature(result);
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

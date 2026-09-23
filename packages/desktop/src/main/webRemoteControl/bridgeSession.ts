import { MessagePortProtocol } from "@zcode/rpc";
import {
  buildWebRemoteControlBridgeResultTelemetry,
  classifyRemoteUsageError,
  measureWebRemoteControlRpcRelayEnvelopeBytes,
  type WebRemoteControlAppPayload,
} from "@zcode/shared";
import { createAcknowledgedWebRemoteControlRelayProtocol } from "./acknowledgedRelayProtocol.js";
import { sendAppPayload } from "./outboundBuffer.js";
import {
  degradeBridgeAfterRawFault,
  disposeRuntimeBridgeResources,
  isCurrentBridgeRuntime,
  buildWorkspaceListResult,
  emitRuntimeStatus,
  reportRemoteUsageEvent,
  resolveRemoteKind,
  type BridgeRouterState,
} from "./bridgeRouter.js";
import {
  mapWorkspaceBridgeFailureReason,
  type WebRemoteControlBridge,
  type WebRemoteControlManagerDependencies,
  type WebRemoteControlRuntime,
} from "./runtimeTypes.js";
import {
  buildBootstrapResult,
  getAvailableWorkspaces,
  bridgeIdentityFields,
  isBridgeableRemoteWorkspace,
  toExternalBridge,
  resolveWebRemoteControlWorkspaceKey,
} from "./workspaceProjection.js";
import { wrapElectronPort } from "./wrapElectronPort.js";

export async function createWorkspaceBridge(
  deps: WebRemoteControlManagerDependencies,
  state: BridgeRouterState,
  runtime: WebRemoteControlRuntime,
  request: Extract<WebRemoteControlAppPayload, { zcode_type: "workspace-bridge-open" }>,
): Promise<Record<string, unknown>> {
  const target = getAvailableWorkspaces(runtime, state.workspaces.get(runtime.windowId) ?? []).find(
    (workspace) => resolveWebRemoteControlWorkspaceKey(workspace) === request.workspaceKey,
  );
  if (!target) throw new Error("目标工作区不在当前桌面窗口中，无法创建 Web 远程控制 bridge。");
  if (!isBridgeableRemoteWorkspace(target)) {
    throw new Error("目标远程工作区尚未连接，无法创建 bridge，请先重连。");
  }
  disposeRuntimeBridgeResources(deps, runtime);
  runtime.status = "connecting";
  runtime.error = undefined;
  runtime.failure = undefined;
  emitRuntimeStatus(deps, runtime);
  const bridge: WebRemoteControlBridge = {
    bridgeSessionId: request.bridgeSessionId,
    bridgeGeneration: request.bridgeGeneration,
    recoveryId: request.recoveryId,
    hostEntryId: "",
    attachmentId: "",
    kind: target.kind,
    workspaceKey: resolveWebRemoteControlWorkspaceKey(target),
    workspacePath: target.workspacePath,
    workspaceIdentity: target.workspaceIdentity,
    remoteSessionId: target.remoteSessionId,
    initialTaskId: request.taskId,
    readyAnnounced: false,
    degraded: false,
  };
  runtime.currentBridge = bridge;
  deps.logger.info(
    `[web-remote-control] attaching workspace bridge window=${runtime.windowId} session=${runtime.deviceSid} bridgeSession=${request.bridgeSessionId} workspace=${target.workspacePath}`,
  );
  let attached:
    | Awaited<ReturnType<WebRemoteControlManagerDependencies["attachWorkspaceHost"]>>
    | undefined;
  try {
    attached = await deps.attachWorkspaceHost(runtime.windowId, {
      workspacePath: target.workspacePath,
      workspaceIdentity: target.workspaceIdentity,
      remoteSessionId: target.remoteSessionId,
      initialTaskId: request.taskId,
      kind: target.kind,
    });
    if (!isCurrentBridgeRuntime(state, runtime, bridge)) {
      deps.releaseWorkspaceHostAttachment(attached.attachmentId);
      attached = undefined;
      throw new Error("Workspace bridge request was superseded.");
    }
    const hostProtocol = new MessagePortProtocol(wrapElectronPort(attached.port));
    const relay = createAcknowledgedWebRemoteControlRelayProtocol({
      bridgeSessionId: bridge.bridgeSessionId,
      bridgeGeneration: bridge.bridgeGeneration,
      recoveryId: bridge.recoveryId,
      measureFrameBytes: (frame) =>
        runtime.transport.measurePayloadBytes(frame as object) ??
        measureWebRemoteControlRpcRelayEnvelopeBytes(frame),
      sendFrame: (frame) => {
        if (!bridge.readyAnnounced || bridge.degraded) return false;
        const result = runtime.transport.sendPayloadResult(frame);
        if (result.kind === "oversize") throw new Error("remote.rpcFrame.envelopeTooLarge");
        return result.kind === "sent";
      },
    });
    const disposeHostToRelay = hostProtocol.onMessage((buffer) => relay.protocol.send(buffer));
    const disposeRelayToHost = relay.protocol.onMessage((buffer) => hostProtocol.send(buffer));
    const disposeDegraded = relay.onDegraded((fault) =>
      degradeBridgeAfterRawFault(deps, state, runtime, bridge, fault.reasonCode),
    );
    const disposeSaturated = relay.onSaturated(() => {
      if (!isCurrentBridgeRuntime(state, runtime, bridge) || bridge.degraded) return;
      hostProtocol.sendFlowState("saturated");
    });
    const disposeDrained = relay.onDrained(() => {
      if (!isCurrentBridgeRuntime(state, runtime, bridge) || bridge.degraded) return;
      hostProtocol.sendFlowState("drained");
    });
    bridge.hostEntryId = attached.entryId;
    bridge.attachmentId = attached.attachmentId;
    bridge.hostProtocol = hostProtocol;
    bridge.relayProtocol = relay;
    bridge.disposeBridge = () => {
      disposeHostToRelay.dispose();
      disposeRelayToHost.dispose();
      disposeDegraded.dispose();
      disposeSaturated.dispose();
      disposeDrained.dispose();
    };
    runtime.status = "active";
    runtime.error = undefined;
    runtime.failure = undefined;
    emitRuntimeStatus(deps, runtime);
    deps.logger.info(
      `[web-remote-control] workspace bridge active window=${runtime.windowId} session=${runtime.deviceSid} bridgeSession=${request.bridgeSessionId}`,
    );
    reportRemoteUsageEvent(
      deps,
      runtime.windowId,
      buildWebRemoteControlBridgeResultTelemetry({
        result: "success",
        workspaceKind: target.kind,
        remoteKind: resolveRemoteKind(target, attached),
        entryKind: request.taskId ? "task" : "home",
      }),
    );
    return toExternalBridge(bridge);
  } catch (error) {
    reportRemoteUsageEvent(
      deps,
      runtime.windowId,
      buildWebRemoteControlBridgeResultTelemetry({
        result: "failure",
        workspaceKind: target.kind,
        remoteKind: resolveRemoteKind(target, attached),
        entryKind: request.taskId ? "task" : "home",
        errorCategory: classifyRemoteUsageError(error),
      }),
    );
    if (attached) deps.releaseWorkspaceHostAttachment(attached.attachmentId);
    if (isCurrentBridgeRuntime(state, runtime, bridge)) {
      disposeRuntimeBridgeResources(deps, runtime);
      runtime.status = runtime.mobileConnected ? "active" : "running";
      emitRuntimeStatus(deps, runtime);
    }
    throw error;
  }
}

async function respondToWorkspaceBridgeOpen(
  deps: WebRemoteControlManagerDependencies,
  state: BridgeRouterState,
  runtime: WebRemoteControlRuntime,
  request: Extract<WebRemoteControlAppPayload, { zcode_type: "workspace-bridge-open" }>,
): Promise<void> {
  try {
    const bridge = await createWorkspaceBridge(deps, state, runtime, request);
    sendAppPayload(
      runtime,
      {
        zcode_type: "workspace-bridge-ready",
        requestId: request.requestId,
        ...bridgeIdentityFields(request),
        bridge,
      },
      deps.logger,
    );
    const current = runtime.currentBridge;
    if (
      current?.bridgeSessionId === request.bridgeSessionId &&
      current.bridgeGeneration === request.bridgeGeneration
    ) {
      current.readyAnnounced = true;
      current.relayProtocol?.flushPendingFrames();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.warn(
      `[web-remote-control] workspace bridge failed window=${runtime.windowId} session=${runtime.deviceSid} workspaceKey=${request.workspaceKey} error=${message}`,
    );
    sendAppPayload(
      runtime,
      {
        zcode_type: "workspace-bridge-error",
        requestId: request.requestId,
        ...bridgeIdentityFields(request),
        reason: mapWorkspaceBridgeFailureReason(error),
        error: message,
      },
      deps.logger,
    );
  }
}

export function routePayload(
  deps: WebRemoteControlManagerDependencies,
  state: BridgeRouterState,
  runtime: WebRemoteControlRuntime,
  payload: WebRemoteControlAppPayload,
): void {
  switch (payload.zcode_type) {
    case "bootstrap-request":
      sendAppPayload(
        runtime,
        {
          zcode_type: "bootstrap-response",
          requestId: payload.requestId,
          success: true,
          result: buildBootstrapResult({
            runtime,
            appVersion: deps.appVersion,
            workspaces: state.workspaces.get(runtime.windowId) ?? [],
            tasks: state.tasks.get(runtime.windowId) ?? [],
          }),
        },
        deps.logger,
      );
      return;
    case "workspace-list-request":
      sendAppPayload(
        runtime,
        {
          zcode_type: "workspace-list-response",
          requestId: payload.requestId,
          success: true,
          result: buildWorkspaceListResult(state, runtime),
        },
        deps.logger,
      );
      return;
    case "platform-request":
      void respondToPlatformRequest(deps, runtime, payload);
      return;
    case "mobile-view-state-update":
      applyMobileViewStateUpdate(runtime, payload.viewState, payload.deviceInfo);
      return;
    case "workspace-bridge-open":
      void respondToWorkspaceBridgeOpen(deps, state, runtime, payload);
      return;
    case "workspace-reconnect-request":
      void respondToWorkspaceReconnectRequest(deps, runtime, payload);
      return;
    case "rpc-frame":
    case "rpc-frame-ack":
      routeRpcTransportPayload(runtime, payload);
      return;
    case "telemetry-report":
      deps.reportRendererTelemetryEvent?.(payload.event);
      return;
    case "mobile-diagnostic":
      logMobileDiagnostic(deps, runtime, payload);
      return;
    default:
      return;
  }
}

async function respondToPlatformRequest(
  deps: WebRemoteControlManagerDependencies,
  runtime: WebRemoteControlRuntime,
  request: Extract<WebRemoteControlAppPayload, { zcode_type: "platform-request" }>,
): Promise<void> {
  try {
    const result = await deps.platformHandlers[request.method](request.args);
    sendAppPayload(
      runtime,
      {
        zcode_type: "platform-response",
        requestId: request.requestId,
        method: request.method,
        success: true,
        result,
      },
      deps.logger,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.warn(
      `[web-remote-control] platform request failed window=${runtime.windowId} session=${runtime.deviceSid} method=${request.method} error=${message}`,
    );
    sendAppPayload(
      runtime,
      {
        zcode_type: "platform-response",
        requestId: request.requestId,
        method: request.method,
        success: false,
        error: message,
      },
      deps.logger,
    );
  }
}

// 发布包 keepNames 认 respondToWorkspaceReconnectRequest。缩短后的名字对不上 main。
async function respondToWorkspaceReconnectRequest(
  deps: WebRemoteControlManagerDependencies,
  runtime: WebRemoteControlRuntime,
  request: Extract<WebRemoteControlAppPayload, { zcode_type: "workspace-reconnect-request" }>,
): Promise<void> {
  try {
    await deps.reconnectWorkspace(runtime.windowId, request.workspaceKey);
    sendAppPayload(
      runtime,
      {
        zcode_type: "workspace-reconnect-response",
        requestId: request.requestId,
        workspaceKey: request.workspaceKey,
        success: true,
      },
      deps.logger,
    );
  } catch (error) {
    sendAppPayload(
      runtime,
      {
        zcode_type: "workspace-reconnect-response",
        requestId: request.requestId,
        workspaceKey: request.workspaceKey,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      deps.logger,
    );
  }
}

// 发布包把 rpc 帧先交给 routeRpcTransportPayload，再由 routeRawTransportCandidate 决定是否收下。
function routeRpcTransportPayload(runtime: WebRemoteControlRuntime, payload: unknown): void {
  routeRawTransportCandidate(runtime, payload);
}

export function routeRawTransportCandidate(
  runtime: WebRemoteControlRuntime,
  payload: unknown,
): boolean {
  const bridge = runtime.currentBridge;
  if (!bridge || bridge.degraded) return false;
  return bridge.relayProtocol?.acceptPayload(payload) ?? false;
}

function applyMobileViewStateUpdate(
  runtime: WebRemoteControlRuntime,
  viewState: WebRemoteControlRuntime["mobileViewState"],
  deviceInfo: WebRemoteControlRuntime["mobileDeviceInfo"],
): void {
  runtime.mobileViewState = viewState;
  if (deviceInfo) runtime.mobileDeviceInfo = deviceInfo;
}

function logMobileDiagnostic(
  deps: WebRemoteControlManagerDependencies,
  runtime: WebRemoteControlRuntime,
  payload: Extract<WebRemoteControlAppPayload, { zcode_type: "mobile-diagnostic" }>,
): void {
  deps.logger.info("[web-remote-control] mobile diagnostic", {
    window: runtime.windowId,
    session: runtime.deviceSid,
    event: payload.event,
    state: payload.state,
    previousState: payload.previousState,
    pairStatus: payload.pairStatus,
    closeCode: payload.closeCode,
    closeReason: payload.closeReason,
    wasClean: payload.wasClean,
    wasPaired: payload.wasPaired,
    failureReason: payload.failureReason,
    failureMessage: payload.failureMessage,
    visibilityState: payload.visibilityState,
    online: payload.online,
    hiddenDurationMs: payload.hiddenDurationMs,
    timestamp: payload.timestamp,
  });
}

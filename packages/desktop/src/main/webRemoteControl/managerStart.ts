import { buildWebRemoteControlExternalQrUrl, type WebRemoteControlStatus } from "@zcode/shared";
import { resetExternalRelayDeviceAuth } from "./auth.js";
import { mapTransportState, emitRuntimeStatus, type BridgeRouterState } from "./bridgeRouter.js";
import { routeRawTransportPayload, routeWebRemoteControlPayload } from "./bridgeSession.js";
import { WebRemoteControlDeviceTransport } from "./deviceTransport.js";
import {
  clearMobileDisconnectGraceTimer,
  clearPendingOutboundPayloadTimer,
  flushPendingOutboundPayloads,
} from "./outboundBuffer.js";
import {
  WEB_REMOTE_CONTROL_QR_READY_TIMEOUT_MS,
  type WebRemoteControlManagerDependencies,
  type WebRemoteControlManagerStartInput,
  type WebRemoteControlRuntime,
} from "./runtimeTypes.js";

export async function startWebRemoteControlSession(input: {
  deps: WebRemoteControlManagerDependencies;
  state: BridgeRouterState;
  windowId: number;
  request: WebRemoteControlManagerStartInput;
  stopWindowRuntime: (windowId: number, reason: string) => Promise<void>;
  clearStartAuthorizationsForWindow: (windowId: number) => void;
  markRestoreConsumed: () => void;
}): Promise<WebRemoteControlStatus> {
  const {
    deps,
    state,
    windowId,
    request,
    stopWindowRuntime,
    clearStartAuthorizationsForWindow,
    markRestoreConsumed,
  } = input;
  const runtimes = state.runtimes;
  clearStartAuthorizationsForWindow(windowId);
  deps.featureGate.assertEnabled();
  markRestoreConsumed();
  await stopWindowRuntime(windowId, "restart");
  const endpoints = await deps.getEndpointUrls?.();
  const relayWsUrl = endpoints?.relayWsUrl ?? deps.relayWsUrl;
  const remoteUrl = endpoints?.remoteUrl ?? deps.mobileRemoteControlUrl;
  deps.logger.info(
    `[web-remote-control] start window=${windowId} workspace=${request.workspacePath} remoteSession=${request.remoteSessionId ?? "none"} relay=${relayWsUrl}`,
  );
  const stored = await deps.authStorageProvider.load();
  const auth = stored
    ? { mode: "persisted" as const, deviceSid: stored.deviceSid, passHash: stored.passHash }
    : {
        mode: "register" as const,
        passHash: deps.authProvider.createPassHash(deps.authProvider.createPassword()),
      };
  let persisted =
    auth.mode === "persisted" ? { deviceSid: auth.deviceSid, passHash: auth.passHash } : undefined;
  let registered: { deviceSid: string; passHash: string } | undefined;
  let runtime!: WebRemoteControlRuntime;
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("External relay device did not reach QR-ready state before timeout."));
    }, WEB_REMOTE_CONTROL_QR_READY_TIMEOUT_MS);
    const resolveReady = () => {
      clearTimeout(timer);
      resolve();
    };
    const transport = (
      deps.createDeviceTransport ?? ((options) => new WebRemoteControlDeviceTransport(options))
    )({
      relayWsUrl,
      deviceMid: deps.deviceMid,
      auth,
      meta: { platform: process.platform, version: deps.appVersion, name: deps.deviceName },
      authProvider: deps.authProvider,
      logger: deps.logger,
      relayMessageLogger: deps.relayMessageLogger,
      onRegisteredAuth: (next) => {
        registered = next;
        persisted = next;
      },
      onStateChange: (stateName) => {
        mapTransportState(deps, state, runtime, stateName);
        if ((stateName === "waiting_terminal" || stateName === "paired") && persisted)
          resolveReady();
      },
      onPayload: (payload) => routeWebRemoteControlPayload(deps, state, runtime, payload),
      onRawTransportPayload: (payload) => routeRawTransportPayload(runtime, payload),
      onRawTransportFault: (reasonCode) =>
        runtime.currentBridge?.relayProtocol?.markDegraded(reasonCode),
      onSendReady: () => {
        flushPendingOutboundPayloads(runtime, deps.logger);
        const relay = runtime.currentBridge?.relayProtocol;
        if (!relay || relay.isDegraded()) return;
        relay.replayUnacknowledged();
      },
      onError: (error) => {
        deps.logger.warn("[web-remote-control] external relay device error", {
          message: error.message,
        });
      },
      onInvalidPersistedAuth: async () => {
        await resetExternalRelayDeviceAuth(deps.authStorageProvider, deps.logger, "auth-failed");
      },
    });
    runtime = {
      windowId,
      workspacePath: request.workspacePath,
      workspaceIdentity: request.workspaceIdentity,
      remoteSessionId: request.remoteSessionId,
      initialTaskId: request.initialTaskId,
      theme: request.theme,
      status: "starting",
      deviceSid: persisted?.deviceSid ?? "pending",
      passHash: persisted?.passHash ?? auth.passHash,
      deviceMid: deps.deviceMid,
      connectUrl: "",
      qrUrl: "",
      transport,
      mobileConnected: false,
      hasEverPaired: false,
      pendingOutboundPayloads: [],
    };
    runtimes.set(windowId, runtime);
    emitRuntimeStatus(deps, runtime);
    transport.start();
  });
  try {
    await ready;
  } catch (error) {
    runtimes.delete(windowId);
    clearPendingOutboundPayloadTimer(runtime);
    clearMobileDisconnectGraceTimer(runtime);
    runtime.pendingOutboundPayloads.length = 0;
    runtime.transport.dispose();
    throw error;
  }
  if (!persisted)
    throw new Error("External relay auth was not available after transport became ready.");
  if (registered) await deps.authStorageProvider.save(registered);
  try {
    await deps.startupRestoreStorageProvider.save({
      workspacePath: request.workspacePath,
      workspaceIdentity: request.workspaceIdentity,
      initialTaskId: request.initialTaskId,
    });
  } catch (error) {
    await stopWindowRuntime(windowId, "startup-restore-persist-failed");
    throw error;
  }
  const qrUrl = buildWebRemoteControlExternalQrUrl({
    baseUrl: remoteUrl,
    deviceSid: persisted.deviceSid,
    passHash: persisted.passHash,
    timestamp: Date.now(),
    deviceMid: deps.deviceMid,
    deviceName: deps.deviceName,
    appVersion: deps.appVersion,
  });
  runtime.deviceSid = persisted.deviceSid;
  runtime.passHash = persisted.passHash;
  runtime.qrUrl = qrUrl;
  runtime.connectUrl = qrUrl;
  emitRuntimeStatus(deps, runtime);
  return {
    status: runtime.status === "active" ? "active" : "running",
    sessionId: persisted.deviceSid,
    windowControlSessionId: persisted.deviceSid,
    qrUrl,
    connectUrl: qrUrl,
    workspacePath: request.workspacePath,
    workspaceIdentity: request.workspaceIdentity,
    remoteSessionId: request.remoteSessionId,
    initialTaskId: request.initialTaskId,
  };
}

import { randomUUID } from "node:crypto";
import type {
  WebRemoteControlStatus,
  WebRemoteControlTaskSnapshot,
  WebRemoteControlWorkspaceSnapshot,
} from "@zcode/shared";
import { resetExternalRelayDeviceAuth } from "./auth.js";
import {
  disposeRuntimeBridgeResources,
  emitRuntimeStatus,
  pushWorkspaceListUpdated,
  type BridgeRouterState,
} from "./bridgeRouter.js";
import { startWebRemoteControlSession } from "./managerStart.js";
import {
  clearMobileDisconnectGraceTimer,
  clearPendingOutboundPayloadTimer,
  sendAppPayload,
} from "./outboundBuffer.js";
import {
  createWebRemoteControlFailure,
  WEB_REMOTE_CONTROL_AUTHORIZATION_TTL_MS,
  type WebRemoteControlManagerDependencies,
  type WebRemoteControlManagerStartInput,
  type WebRemoteControlRuntime,
  type WebRemoteControlStartAuthorization,
} from "./runtimeTypes.js";
import {
  bridgeIdentityFields,
  resolveWebRemoteControlWorkspaceKey,
} from "./workspaceProjection.js";

export interface WebRemoteControlManager {
  authorizeStart(
    windowId: number,
    request: WebRemoteControlManagerStartInput,
  ): WebRemoteControlStartAuthorization;
  startAuthorized(
    windowId: number,
    request: WebRemoteControlManagerStartInput,
    authorization: WebRemoteControlStartAuthorization,
  ): Promise<WebRemoteControlStatus>;
  start(
    windowId: number,
    request: WebRemoteControlManagerStartInput,
  ): Promise<WebRemoteControlStatus>;
  stop(windowId: number): Promise<void>;
  suspend(windowId: number, reason: string): Promise<void>;
  restorePreviouslyEnabled(
    windowId: number,
    workspaces: readonly {
      workspacePath: string;
      workspaceIdentity?: string;
      remoteSessionId?: string;
    }[],
  ): Promise<boolean>;
  resetPairing(
    windowId: number,
    request: WebRemoteControlManagerStartInput,
  ): Promise<WebRemoteControlStatus>;
  resetPairingAuthorized(
    windowId: number,
    request: WebRemoteControlManagerStartInput,
    authorization: WebRemoteControlStartAuthorization,
  ): Promise<WebRemoteControlStatus>;
  getStatus(windowId: number): WebRemoteControlStatus;
  syncAvailableWorkspaces(
    windowId: number,
    workspaces: readonly WebRemoteControlWorkspaceSnapshot[],
  ): void;
  syncAvailableTasks(windowId: number, tasks: readonly WebRemoteControlTaskSnapshot[]): void;
  disposeWindow(windowId: number): Promise<void>;
  failRemoteSession(
    remoteSessionId: string,
    reason: string,
    failure: { reason: string; message: string },
  ): void;
}

export function createWebRemoteControlManager(
  deps: WebRemoteControlManagerDependencies,
): WebRemoteControlManager {
  const runtimes = new Map<number, WebRemoteControlRuntime>();
  const authorizations = new Map<string, WebRemoteControlStartAuthorization>();
  const state: BridgeRouterState = {
    runtimes,
    workspaces: new Map(),
    tasks: new Map(),
    signatures: new Map(),
  };
  const startupRestore = deps.startupRestoreStorageProvider.load().catch((error: unknown) => {
    deps.logger.warn("[web-remote-control] load startup restore context failed", error);
  });
  let restoreConsumed = false;

  // 发布包 keepNames 只认具名函数。const 箭头不会留下授权、停止和 idle 这些名字。
  function clearStartAuthorizationsForWindow(windowId: number) {
    for (const [token, authorization] of authorizations) {
      if (authorization.windowId === windowId) authorizations.delete(token);
    }
  }

  function authorizeStart(windowId: number, request: WebRemoteControlManagerStartInput) {
    const now = Date.now();
    clearStartAuthorizationsForWindow(windowId);
    for (const [token, authorization] of authorizations) {
      if (authorization.expiresAt <= now) authorizations.delete(token);
    }
    const authorization: WebRemoteControlStartAuthorization = {
      token: randomUUID(),
      expiresAt: now + WEB_REMOTE_CONTROL_AUTHORIZATION_TTL_MS,
      windowId,
      workspaceKey: resolveWebRemoteControlWorkspaceKey(request),
      ...(request.remoteSessionId ? { remoteSessionId: request.remoteSessionId } : {}),
    };
    authorizations.set(authorization.token, authorization);
    return authorization;
  }

  function consumeStartAuthorization(
    windowId: number,
    request: WebRemoteControlManagerStartInput,
    authorization: WebRemoteControlStartAuthorization,
  ) {
    const current = authorizations.get(authorization.token);
    authorizations.delete(authorization.token);
    if (!current || current !== authorization) {
      throw new Error("Web remote control authorization is invalid or already used");
    }
    if (current.expiresAt <= Date.now())
      throw new Error("Web remote control authorization expired");
    if (
      current.windowId !== windowId ||
      current.workspaceKey !== resolveWebRemoteControlWorkspaceKey(request) ||
      current.remoteSessionId !== request.remoteSessionId
    ) {
      throw new Error("Web remote control authorization target mismatch");
    }
  }

  function emitIdleStatus(windowId: number) {
    deps.onStatusChanged?.(windowId, { status: "idle" });
  }

  async function stopWindowRuntime(windowId: number, reason: string) {
    const runtime = runtimes.get(windowId);
    if (!runtime) return;
    sendAppPayload(
      runtime,
      {
        zcode_type: "app-error",
        reason: "desktop-disconnected",
        error: "Desktop disconnected this Web remote control session.",
      },
      deps.logger,
    );
    runtimes.delete(windowId);
    state.signatures.delete(windowId);
    disposeRuntimeBridgeResources(deps, runtime);
    clearPendingOutboundPayloadTimer(runtime);
    clearMobileDisconnectGraceTimer(runtime);
    runtime.pendingOutboundPayloads.length = 0;
    runtime.transport.dispose();
    deps.disposeWorkspaceHostAttachmentsForWindow(windowId, reason);
    deps.logger.info(
      `[web-remote-control] stopped window=${windowId} session=${runtime.deviceSid} reason=${reason}`,
    );
    emitIdleStatus(windowId);
  }

  const manager: WebRemoteControlManager = {
    authorizeStart,
    async startAuthorized(windowId, request, authorization) {
      consumeStartAuthorization(windowId, request, authorization);
      return manager.start(windowId, request);
    },
    async start(windowId, request) {
      return startWebRemoteControlSession({
        deps,
        state,
        windowId,
        request,
        stopWindowRuntime,
        clearStartAuthorizationsForWindow,
        markRestoreConsumed: () => {
          restoreConsumed = true;
        },
      });
    },
    async stop(windowId) {
      clearStartAuthorizationsForWindow(windowId);
      await stopWindowRuntime(windowId, "manual-stop");
      await deps.startupRestoreStorageProvider.clear();
    },
    async suspend(windowId, reason) {
      clearStartAuthorizationsForWindow(windowId);
      await stopWindowRuntime(windowId, reason);
    },
    async restorePreviouslyEnabled(windowId, workspaces) {
      if (restoreConsumed || runtimes.has(windowId)) return false;
      const saved = await startupRestore;
      if (restoreConsumed || !saved) return false;
      const key = resolveWebRemoteControlWorkspaceKey(saved);
      const match = workspaces.find(
        (workspace) => resolveWebRemoteControlWorkspaceKey(workspace) === key,
      );
      if (!match) return false;
      restoreConsumed = true;
      deps.logger.info(
        `[web-remote-control] restoring previous enabled state window=${windowId} workspace=${match.workspacePath} remoteSession=${match.remoteSessionId ?? "none"}`,
      );
      try {
        await manager.start(windowId, {
          workspacePath: match.workspacePath,
          workspaceIdentity: match.workspaceIdentity,
          remoteSessionId: match.remoteSessionId,
          initialTaskId: saved.initialTaskId,
        });
        return true;
      } catch (error) {
        restoreConsumed = false;
        deps.logger.warn("[web-remote-control] restore previous enabled state failed", error);
        return false;
      }
    },
    async resetPairing(windowId, request) {
      deps.featureGate.assertEnabled();
      await stopWindowRuntime(windowId, "leaked-qr");
      await resetExternalRelayDeviceAuth(deps.authStorageProvider, deps.logger, "leaked-qr");
      return manager.start(windowId, request);
    },
    async resetPairingAuthorized(windowId, request, authorization) {
      consumeStartAuthorization(windowId, request, authorization);
      return manager.resetPairing(windowId, request);
    },
    getStatus(windowId) {
      if (!deps.featureGate.isEnabled()) {
        return {
          status: "idle",
          failure: createWebRemoteControlFailure(
            "unsupported-action",
            "Web remote control is disabled in this build.",
          ),
        };
      }
      const runtime = runtimes.get(windowId);
      if (!runtime) return { status: "idle" };
      const target = {
        workspacePath: runtime.workspacePath,
        workspaceIdentity: runtime.workspaceIdentity,
        remoteSessionId: runtime.remoteSessionId,
      };
      return {
        status: runtime.status,
        sessionId: runtime.deviceSid,
        windowControlSessionId: runtime.deviceSid,
        mobileConnected: runtime.mobileConnected,
        mobileViewState: runtime.mobileViewState,
        mobileDeviceInfo: runtime.mobileDeviceInfo,
        qrUrl: runtime.qrUrl,
        connectUrl: runtime.connectUrl,
        ...target,
        initialTaskId: runtime.currentBridge?.initialTaskId ?? runtime.initialTaskId,
        error: runtime.error,
        failure: runtime.failure,
      };
    },
    syncAvailableWorkspaces(windowId, workspaces) {
      const runtime = runtimes.get(windowId);
      state.workspaces.set(windowId, workspaces);
      if (runtime) pushWorkspaceListUpdated(deps, state, runtime);
    },
    syncAvailableTasks(windowId, tasks) {
      const runtime = runtimes.get(windowId);
      state.tasks.set(windowId, tasks);
      if (runtime) pushWorkspaceListUpdated(deps, state, runtime);
    },
    async disposeWindow(windowId) {
      clearStartAuthorizationsForWindow(windowId);
      await stopWindowRuntime(windowId, "window-disposed");
      state.workspaces.delete(windowId);
      state.tasks.delete(windowId);
      state.signatures.delete(windowId);
    },
    failRemoteSession(remoteSessionId, reason, failure) {
      for (const [windowId, runtime] of runtimes) {
        const bridge = runtime.currentBridge;
        const bridgeMatches = bridge?.remoteSessionId === remoteSessionId;
        const runtimeMatches = runtime.remoteSessionId === remoteSessionId;
        if (!bridgeMatches && !runtimeMatches) continue;
        if (bridgeMatches && bridge) {
          disposeRuntimeBridgeResources(deps, runtime);
          sendAppPayload(
            runtime,
            {
              zcode_type: "workspace-bridge-error",
              ...bridgeIdentityFields(bridge),
              requestId: `remote-session-closed:${remoteSessionId}`,
              reason: failure.reason,
              error: failure.message ?? failure.reason,
            },
            deps.logger,
          );
        }
        if (runtimeMatches) runtime.remoteSessionId = undefined;
        runtime.status = runtime.mobileConnected ? "active" : "running";
        runtime.error = undefined;
        runtime.failure = undefined;
        runtimes.set(windowId, runtime);
        emitRuntimeStatus(deps, runtime);
      }
      deps.disposeWorkspaceHostAttachmentsForRemoteSession(remoteSessionId, reason);
    },
  };
  return manager;
}

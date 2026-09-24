import type { MessagePortMain, UtilityProcess as ElectronUtilityProcess } from "electron";
import type { MessagePortProtocol } from "@zcode/rpc";
import type {
  TelemetryEventPayload,
  WebRemoteControlAppPayload,
  WebRemoteControlFailure,
  WebRemoteControlLastEnabledContext,
  WebRemoteControlPhase,
  WebRemoteControlStartRequest,
  WebRemoteControlStatus,
} from "@zcode/shared";
import type { AcknowledgedRelayProtocol } from "./acknowledgedRelayProtocol.js";
import type {
  WebRemoteControlDeviceTransport,
  WebRemoteControlTransportState,
} from "./deviceTransport.js";
import type {
  WebRemoteControlFeatureGate,
  WebRemoteControlRelayAuthProvider,
  WebRemoteControlRelayAuthStorage,
} from "./auth.js";

export const WEB_REMOTE_CONTROL_AUTHORIZATION_TTL_MS = 30_000;
export const WEB_REMOTE_CONTROL_QR_READY_TIMEOUT_MS = 30_000;
export const WEB_REMOTE_CONTROL_MOBILE_DISCONNECT_GRACE_MS = 3_000;
export const WEB_REMOTE_CONTROL_OUTBOUND_BUFFER_LIMIT = 50;
export const WEB_REMOTE_CONTROL_OUTBOUND_DROP_MS = 5_000;

export interface WebRemoteControlLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export type WebRemoteControlPlatformMethod = Extract<
  WebRemoteControlAppPayload,
  { zcode_type: "platform-request" }
>["method"];

export type WebRemoteControlMobileView = Extract<
  WebRemoteControlAppPayload,
  { zcode_type: "mobile-view-state-update" }
>["viewState"];

export type WebRemoteControlMobileDeviceInfo = NonNullable<
  Extract<WebRemoteControlAppPayload, { zcode_type: "mobile-view-state-update" }>["deviceInfo"]
>;

export interface WebRemoteControlBridge {
  bridgeSessionId: string;
  bridgeGeneration?: number;
  recoveryId?: string;
  hostEntryId: string;
  attachmentId: string;
  kind: "local" | "remote";
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
  readyAnnounced: boolean;
  degraded: boolean;
  hostProtocol?: MessagePortProtocol;
  relayProtocol?: AcknowledgedRelayProtocol;
  disposeBridge?: () => void;
}

export interface WebRemoteControlRuntime {
  windowId: number;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
  theme?: string;
  status: WebRemoteControlPhase;
  deviceSid: string;
  passHash: string;
  deviceMid: string;
  connectUrl: string;
  qrUrl: string;
  transport: WebRemoteControlDeviceTransport;
  transportState?: WebRemoteControlTransportState;
  mobileConnected: boolean;
  hasEverPaired: boolean;
  mobileViewState?: WebRemoteControlMobileView;
  mobileDeviceInfo?: WebRemoteControlMobileDeviceInfo;
  error?: string;
  failure?: WebRemoteControlFailure;
  currentBridge?: WebRemoteControlBridge;
  pendingOutboundPayloads: object[];
  pendingOutboundPayloadTimer?: ReturnType<typeof setTimeout>;
  mobileDisconnectGraceTimer?: ReturnType<typeof setTimeout>;
}

export interface WebRemoteControlStartAuthorization {
  token: string;
  expiresAt: number;
  windowId: number;
  workspaceKey: string;
  remoteSessionId?: string;
}

export interface WebRemoteControlAttachedHost {
  entryId: string;
  attachmentId: string;
  process: ElectronUtilityProcess;
  port: MessagePortMain;
  remoteKind?: string;
}

export interface WebRemoteControlManagerDependencies {
  getEndpointUrls?: () => Promise<{ relayWsUrl?: string; remoteUrl?: string } | undefined>;
  relayWsUrl: string;
  mobileRemoteControlUrl: string;
  deviceMid: string;
  deviceName: string;
  appVersion: string;
  authProvider: WebRemoteControlRelayAuthProvider;
  authStorageProvider: WebRemoteControlRelayAuthStorage;
  startupRestoreStorageProvider: {
    load: () => Promise<WebRemoteControlLastEnabledContext | undefined>;
    save: (context: WebRemoteControlLastEnabledContext) => Promise<void>;
    clear: () => Promise<void>;
  };
  featureGate: WebRemoteControlFeatureGate;
  logger: WebRemoteControlLogger;
  relayMessageLogger?: WebRemoteControlDeviceTransportOptionsLogger;
  platformHandlers: {
    [Method in WebRemoteControlPlatformMethod]: (args: unknown) => unknown;
  };
  reconnectWorkspace: (windowId: number, workspaceKey: string) => Promise<void>;
  reportRendererTelemetryEvent?: (
    event: Extract<WebRemoteControlAppPayload, { zcode_type: "telemetry-report" }>["event"],
  ) => void;
  reportRemoteUsageEvent?: (windowId: number, event: TelemetryEventPayload) => void;
  onStatusChanged?: (windowId: number, status: WebRemoteControlStatus) => void;
  attachWorkspaceHost: (
    windowId: number,
    target: {
      workspacePath: string;
      workspaceIdentity?: string;
      remoteSessionId?: string;
      initialTaskId?: string;
      kind: "local" | "remote";
    },
  ) => Promise<WebRemoteControlAttachedHost>;
  releaseWorkspaceHostAttachment: (attachmentId: string) => void;
  disposeWorkspaceHostAttachmentsForWindow: (windowId: number, reason: string) => void;
  disposeWorkspaceHostAttachmentsForRemoteSession: (
    remoteSessionId: string,
    reason: string,
  ) => void;
  createDeviceTransport?: (
    options: ConstructorParameters<typeof WebRemoteControlDeviceTransport>[0],
  ) => WebRemoteControlDeviceTransport;
}

type WebRemoteControlDeviceTransportOptionsLogger = {
  info: (entry: unknown) => void;
};

export type WebRemoteControlManagerStartInput = WebRemoteControlStartRequest;

export function createFailure(reason: string, message: string): WebRemoteControlFailure {
  return { reason, message };
}

export { createFailure as createWebRemoteControlFailure };

export function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

export function mapWorkspaceBridgeFailureReason(error: unknown): string {
  switch (getErrorCode(error)) {
    case "DESKTOP_HOST_MISSING":
      return "desktop-disconnected";
    case "REMOTE_SESSION_MISSING":
    case "REMOTE_SESSION_WINDOW_MISMATCH":
      return "workspace-closed";
    case "REMOTE_WORKSPACE_IDENTITY_MISSING":
    case "REMOTE_WORKSPACE_IDENTITY_MISMATCH":
      return "unsupported-action";
    default:
      return "unexpected-error";
  }
}

import type { RemoteTarget } from "./remoteTarget.js";
import type { SessionWorkflowActivity } from "./zcode-protocol-v4/sessions-index-workflow-activity.js";
import type { WorkspacePurpose } from "./workspacePurpose.js";

/**
 * 发布包 main 的 `buildRuntimeStatus` 使用 idle / running / active。
 * renderer 在 start 与 refresh 返回 `cancelled` 时把界面收成 idle，所以协议保留这个字。
 */
export type WebRemoteControlPhase = "idle" | "running" | "active" | "cancelled";

export interface WebRemoteControlFailure {
  reason: string;
  message: string;
}

/** 手机上报后，桌面侧只读 `activeWorkspaceKey` 与 `activeTaskId`。 */
export interface WebRemoteControlMobileViewState {
  activeWorkspaceKey?: string;
  activeTaskId?: string;
}

export interface WebRemoteControlStatus {
  status: WebRemoteControlPhase;
  sessionId?: string;
  windowControlSessionId?: string;
  mobileConnected?: boolean;
  mobileViewState?: WebRemoteControlMobileViewState;
  /** 发布包原样转发，桌面侧没有再展开字段。 */
  mobileDeviceInfo?: unknown;
  qrUrl?: string;
  connectUrl?: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
  error?: string;
  failure?: WebRemoteControlFailure;
}

export interface WebRemoteControlStartRequest {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
}

export interface WebRemoteControlWorkspaceSnapshot {
  workspacePath: string;
  label: string;
  kind: "local" | "remote";
  connectionState?: "connected" | "disconnected" | "reconnecting";
  workspaceIdentity?: string;
  workspacePurpose?: WorkspacePurpose;
  remoteSessionId?: string;
  lastConnectionError?: string;
}

export interface WebRemoteControlTaskSnapshot {
  taskId: string;
  title: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  workspaceLabel: string;
  workspaceKind: "local" | "remote";
  createdAt: number;
  updatedAt: number;
  provider?: string;
  unreadAt?: number;
  displayStatus: string;
  hasBackgroundWork?: true;
  workflowActivity?: SessionWorkflowActivity;
  pinned?: true;
  archived?: true;
}

export interface WebRemoteControlReconnectWorkspaceRequest {
  requestId: string;
  workspaceKey: string;
}

export interface WebRemoteControlReconnectWorkspaceResult {
  requestId: string;
  workspaceKey: string;
  success: boolean;
  error?: string;
}

/** Main 在 Bot 远端 workspace 重连成功后推给 renderer。 */
export interface BotRemoteWorkspaceReconnectedEvent {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity: string;
  target: RemoteTarget;
}

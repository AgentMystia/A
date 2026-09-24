import type { RemoteTarget } from "./remoteTarget.js";
import type { SessionWorkflowActivity } from "./zcode-protocol-v4/sessions-index-workflow-activity.js";
import type { WorkspacePurpose } from "./workspacePurpose.js";

/**
 * Manager 会写出 starting / running / connecting / active / error。
 * renderer 在 start 与 refresh 返回 cancelled 时把界面收成 idle，所以协议保留这个字。
 */
export type WebRemoteControlPhase =
  | "idle"
  | "starting"
  | "running"
  | "connecting"
  | "active"
  | "error"
  | "cancelled";

export interface WebRemoteControlFailure {
  reason: string;
  message: string;
}

/** 手机上报后，桌面侧只读 `activeWorkspaceKey` 与 `activeTaskId`。 */
export interface WebRemoteControlMobileViewState {
  activeWorkspaceKey?: string;
  activeTaskId?: string;
  /** 发布包状态相等比较会读这个时间，避免轮询把相同快照写成新对象。 */
  updatedAt?: number;
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
  /** 发布包会收下 theme，但二维码查询参数不包含它。 */
  theme?: string;
}

/** Settings 里的上次开启上下文。passHash 不在这里。 */
export interface WebRemoteControlLastEnabledContext {
  workspacePath: string;
  workspaceIdentity?: string;
  initialTaskId?: string;
}

/** Settings 只保存 deviceSid。passHash 在凭据服务。 */
export interface WebRemoteControlExternalRelayDevice {
  deviceSid: string;
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
  /** 发布包 task schema 允许缺省，签名计算时按 idle。 */
  displayStatus?: "idle" | "running" | "completed" | "error";
  hasBackgroundWork?: boolean;
  workflowActivity?: SessionWorkflowActivity;
  pinned?: boolean;
  archived?: boolean;
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

import type {
  WebRemoteControlTaskSnapshot,
  WebRemoteControlWorkspaceSnapshot,
} from "@zcode/shared";

export type WebRemoteControlMobileNavigationIntent = "home" | "chat";

export type WebRemoteControlMobileOrganizeBy = "workspace" | "timeline";

export type WebRemoteControlMobileSortBy = "created" | "updated";

export interface WebRemoteControlMobileTaskHomePreferences {
  organizeBy: WebRemoteControlMobileOrganizeBy;
  sortBy: WebRemoteControlMobileSortBy;
}

/** 终端传输态。发布包模块快照初始是 idle，客户端没有再写入。 */
export type WebRemoteControlTerminalTransportState = "idle" | "reconnecting";

export interface WebRemoteControlMobileWorkspaceList {
  workspaces: WebRemoteControlWorkspaceSnapshot[];
  tasks: WebRemoteControlTaskSnapshot[];
  activeWorkspaceKey?: string;
  activeTaskId?: string;
}

export interface WebRemoteControlMobileSwitchWorkspaceOptions {
  taskId?: string;
  mobileNavigationIntent?: WebRemoteControlMobileNavigationIntent;
  markTaskReadExpectedUnreadAt?: number;
}

export interface WebRemoteControlMobileStartDraftOptions {
  mobileNavigationIntent: "chat";
}

/**
 * 手机首页只调用这份入口。列表和会话真值留在注入方，不在 renderer 再存一份已接受队列。
 * 发布包 renderer 只有调用点，没有这份对象的构造。
 */
export interface WebRemoteControlMobileSwitcher {
  listWorkspaces: () => Promise<WebRemoteControlMobileWorkspaceList>;
  onWorkspaceListUpdated?: (
    listener: (result: WebRemoteControlMobileWorkspaceList) => void,
  ) => void | (() => void);
  reconnectWorkspace?: (workspaceKey: string) => Promise<void>;
  startDraft?: (
    workspaceKey: string,
    options: WebRemoteControlMobileStartDraftOptions,
  ) => Promise<void>;
  switchWorkspace: (
    workspaceKey: string,
    options: WebRemoteControlMobileSwitchWorkspaceOptions,
  ) => Promise<void>;
  updateMobileViewState?: (workspaceKey: string, taskId?: string) => Promise<void>;
  markTaskRead?: (task: WebRemoteControlTaskSnapshot) => Promise<void>;
}

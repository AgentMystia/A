import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import { z } from "zod";
import {
  buildWebRemoteControlStartResultTelemetry,
  classifyRemoteUsageError,
  formatZodError,
  parseRemoteWorkspaceIdentity,
  PlatformChannels,
  webRemoteControlTaskSyncSchema,
  webRemoteControlWorkspaceSyncSchema,
  type WebRemoteControlStartRequest,
  type WebRemoteControlStatus,
  type WebRemoteControlTaskSnapshot,
  type WebRemoteControlWorkspaceSnapshot,
  type TelemetryEventPayload,
} from "@zcode/shared";
import type { WebRemoteControlManager } from "./manager.js";
import type { WebRemoteControlLogger } from "./runtimeTypes.js";

const RECONNECT_TIMEOUT_MS = 120_000;

const reconnectResultSchema = z.object({
  requestId: z.string(),
  workspaceKey: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
});

export function reconnectWebRemoteControlWorkspaceInRenderer(
  windowId: number,
  workspaceKey: string,
): Promise<void> {
  const win = BrowserWindow.fromId(windowId);
  if (!win || win.isDestroyed()) {
    throw new Error("Desktop window is not available for Web remote control reconnect.");
  }
  const request = {
    requestId: `web-remote-reconnect-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    workspaceKey,
  };
  return new Promise((resolve, reject) => {
    const dispose = () => {
      clearTimeout(timer);
      ipcMain.removeListener(PlatformChannels.WebRemoteControlReconnectWorkspace, handleResult);
    };
    const timer = setTimeout(() => {
      dispose();
      reject(new Error("Web remote control reconnect request timed out."));
    }, RECONNECT_TIMEOUT_MS);
    const handleResult = (event: IpcMainEvent, payload: unknown) => {
      if (event.sender.id !== win.webContents.id) return;
      const parsed = reconnectResultSchema.safeParse(payload);
      if (!parsed.success || parsed.data.requestId !== request.requestId) return;
      dispose();
      if (parsed.data.success) {
        resolve();
        return;
      }
      reject(new Error(parsed.data.error ?? ""));
    };
    ipcMain.on(PlatformChannels.WebRemoteControlReconnectWorkspace, handleResult);
    win.webContents.send(PlatformChannels.WebRemoteControlReconnectWorkspace, request);
  });
}

export function sendWebRemoteControlStatusChangedToWindow(
  windowId: number,
  status: WebRemoteControlStatus,
): void {
  const win = BrowserWindow.fromId(windowId);
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(PlatformChannels.WebRemoteControlStatusChanged, status);
}

function reportStart(
  report: ((rendererId: number, event: TelemetryEventPayload) => void) | undefined,
  rendererId: number,
  event: TelemetryEventPayload,
): void {
  try {
    report?.(rendererId, event);
  } catch {
    // 启动埋点失败不改变开启结果。
  }
}

async function runStartOperation(input: {
  context: WebRemoteControlStartRequest;
  senderId: number;
  windowId: number | undefined;
  missingWindowMessage: string;
  operation: (windowId: number) => Promise<WebRemoteControlStatus>;
  reportRemoteUsageEvent?: (rendererId: number, event: TelemetryEventPayload) => void;
}): Promise<WebRemoteControlStatus> {
  const workspaceKind =
    input.context.workspaceIdentity?.trim() || input.context.remoteSessionId?.trim()
      ? "remote"
      : "local";
  const remoteKind = input.context.workspaceIdentity
    ? parseRemoteWorkspaceIdentity(input.context.workspaceIdentity)?.kind
    : undefined;
  try {
    if (input.windowId === undefined) throw new Error(input.missingWindowMessage);
    const status = await input.operation(input.windowId);
    reportStart(
      input.reportRemoteUsageEvent,
      input.senderId,
      buildWebRemoteControlStartResultTelemetry({
        result: "success",
        workspaceKind,
        remoteKind,
      }),
    );
    return status;
  } catch (error) {
    reportStart(
      input.reportRemoteUsageEvent,
      input.senderId,
      buildWebRemoteControlStartResultTelemetry({
        result: "failure",
        workspaceKind,
        remoteKind,
        errorCategory: classifyRemoteUsageError(error),
      }),
    );
    throw error;
  }
}

export function registerWebRemoteControlIpcHandlers(options: {
  manager: WebRemoteControlManager;
  reportRemoteUsageEvent?: (rendererId: number, event: TelemetryEventPayload) => void;
}): void {
  ipcMain.handle(
    PlatformChannels.StartWebRemoteControl,
    async (event, payload: WebRemoteControlStartRequest) =>
      runStartOperation({
        context: payload,
        senderId: event.sender.id,
        windowId: BrowserWindow.fromWebContents(event.sender)?.id,
        missingWindowMessage: "未找到当前窗口，无法开启 Web 远程控制",
        operation: (windowId) => {
          const authorization = options.manager.authorizeStart(windowId, payload);
          return options.manager.startAuthorized(windowId, payload, authorization);
        },
        reportRemoteUsageEvent: options.reportRemoteUsageEvent,
      }),
  );
  ipcMain.handle(
    PlatformChannels.ResetWebRemoteControlPairing,
    async (event, payload: WebRemoteControlStartRequest) =>
      runStartOperation({
        context: payload,
        senderId: event.sender.id,
        windowId: BrowserWindow.fromWebContents(event.sender)?.id,
        missingWindowMessage: "未找到当前窗口，无法刷新 Web 远程控制二维码",
        operation: (windowId) => {
          const authorization = options.manager.authorizeStart(windowId, payload);
          return options.manager.resetPairingAuthorized(windowId, payload, authorization);
        },
        reportRemoteUsageEvent: options.reportRemoteUsageEvent,
      }),
  );
  ipcMain.handle(PlatformChannels.StopWebRemoteControl, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) await options.manager.stop(win.id);
  });
  ipcMain.handle(PlatformChannels.GetWebRemoteControlStatus, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? options.manager.getStatus(win.id) : { status: "idle" as const };
  });
}

export function registerWebRemoteControlSyncListeners(options: {
  logger: WebRemoteControlLogger;
  syncWorkspaces: (windowId: number, workspaces: WebRemoteControlWorkspaceSnapshot[]) => void;
  syncTasks: (windowId: number, tasks: WebRemoteControlTaskSnapshot[]) => void;
}): void {
  ipcMain.on(PlatformChannels.SyncWebRemoteControlWorkspaces, (event, payload: unknown) => {
    const parsed = webRemoteControlWorkspaceSyncSchema.safeParse(payload);
    if (!parsed.success) {
      options.logger.warn(
        "[sync-web-remote-control-workspaces] invalid payload:",
        formatZodError(parsed.error),
      );
      return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) options.syncWorkspaces(win.id, parsed.data);
  });
  ipcMain.on(PlatformChannels.SyncWebRemoteControlTasks, (event, payload: unknown) => {
    const parsed = webRemoteControlTaskSyncSchema.safeParse(payload);
    if (!parsed.success) {
      options.logger.warn(
        "[sync-web-remote-control-tasks] invalid payload:",
        formatZodError(parsed.error),
      );
      return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) options.syncTasks(win.id, parsed.data);
  });
}

import type { BrowserWindow, MessagePortMain } from "electron";
import {
  HostMessageTypes,
  PlatformChannels,
  hostBotRemoteWorkspaceConnectionStatusRequestResponseSchema,
  hostBotRemoteWorkspaceReconnectRequestResponseSchema,
  hostBotRemoteWorkspaceRuntimePortRequestResponseSchema,
  type BotRemoteWorkspaceReconnectedEvent,
  type RemoteTarget,
} from "@zcode/shared";

export const BOT_REMOTE_WORKSPACE_RECONNECT_HANDLER_MISSING =
  "未注入 Bot 远端 workspace 重连处理器。";
export const BOT_REMOTE_WORKSPACE_STATUS_HANDLER_MISSING =
  "未注入 Bot 远端 workspace 连接状态处理器。";
export const BOT_REMOTE_WORKSPACE_RUNTIME_HANDLER_MISSING =
  "未注入 Bot 远端 workspace runtime 处理器。";

export interface BotRemoteWorkspaceHostRequest {
  win: BrowserWindow;
  requestId: string;
  workspacePath: string;
  workspaceIdentity: string;
  target: RemoteTarget;
}

export interface BotRemoteWorkspaceHostHandlers {
  handleBotRemoteWorkspaceReconnectRequest(
    request: BotRemoteWorkspaceHostRequest,
  ): Promise<{ ok?: boolean; sessionId?: string; error?: string }>;
  handleBotRemoteWorkspaceConnectionStatusRequest(
    request: BotRemoteWorkspaceHostRequest,
  ): Promise<{ ok?: boolean; connected?: boolean; error?: string }>;
  handleBotRemoteWorkspaceRuntimePortRequest(
    request: BotRemoteWorkspaceHostRequest,
  ): Promise<{ ok: boolean; port?: MessagePortMain; error?: string }>;
}

interface BotRemoteHostChild {
  postMessage(message: unknown, transfer?: MessagePortMain[]): void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 发布包 spawnHostProcess 对三条 Bot 远端 workspace host 消息的回写。未识别的消息返回 false。 */
export function dispatchBotRemoteWorkspaceHostMessage(params: {
  message: unknown;
  win: BrowserWindow;
  child: BotRemoteHostChild;
  handlers: Partial<BotRemoteWorkspaceHostHandlers>;
}): boolean {
  const reconnect = hostBotRemoteWorkspaceReconnectRequestResponseSchema.safeParse(params.message);
  if (reconnect.success) {
    const handler = params.handlers.handleBotRemoteWorkspaceReconnectRequest;
    if (!handler) {
      params.child.postMessage({
        type: HostMessageTypes.BotRemoteWorkspaceReconnectResult,
        requestId: reconnect.data.requestId,
        ok: false,
        error: BOT_REMOTE_WORKSPACE_RECONNECT_HANDLER_MISSING,
      });
      return true;
    }
    const request = { win: params.win, ...reconnect.data };
    void handler(request)
      .then((result) => {
        params.child.postMessage({
          type: HostMessageTypes.BotRemoteWorkspaceReconnectResult,
          requestId: reconnect.data.requestId,
          ok: result?.ok === true,
          sessionId: result?.sessionId,
          error: result?.error,
        });
      })
      .catch((error: unknown) => {
        params.child.postMessage({
          type: HostMessageTypes.BotRemoteWorkspaceReconnectResult,
          requestId: reconnect.data.requestId,
          ok: false,
          error: errorText(error),
        });
      });
    return true;
  }

  const status = hostBotRemoteWorkspaceConnectionStatusRequestResponseSchema.safeParse(
    params.message,
  );
  if (status.success) {
    const handler = params.handlers.handleBotRemoteWorkspaceConnectionStatusRequest;
    if (!handler) {
      params.child.postMessage({
        type: HostMessageTypes.BotRemoteWorkspaceConnectionStatusResult,
        requestId: status.data.requestId,
        ok: false,
        error: BOT_REMOTE_WORKSPACE_STATUS_HANDLER_MISSING,
      });
      return true;
    }
    const request = { win: params.win, ...status.data };
    void handler(request)
      .then((result) => {
        params.child.postMessage({
          type: HostMessageTypes.BotRemoteWorkspaceConnectionStatusResult,
          requestId: status.data.requestId,
          ok: result?.ok === true,
          connected: result?.connected,
          error: result?.error,
        });
      })
      .catch((error: unknown) => {
        params.child.postMessage({
          type: HostMessageTypes.BotRemoteWorkspaceConnectionStatusResult,
          requestId: status.data.requestId,
          ok: false,
          error: errorText(error),
        });
      });
    return true;
  }

  const runtime = hostBotRemoteWorkspaceRuntimePortRequestResponseSchema.safeParse(params.message);
  if (!runtime.success) return false;
  const handler = params.handlers.handleBotRemoteWorkspaceRuntimePortRequest;
  if (!handler) {
    params.child.postMessage({
      type: HostMessageTypes.BotRemoteWorkspaceRuntimePort,
      requestId: runtime.data.requestId,
      ok: false,
      error: BOT_REMOTE_WORKSPACE_RUNTIME_HANDLER_MISSING,
    });
    return true;
  }
  const request = { win: params.win, ...runtime.data };
  void handler(request)
    .then((result) => {
      if (result.ok && result.port) {
        params.child.postMessage(
          {
            type: HostMessageTypes.BotRemoteWorkspaceRuntimePort,
            requestId: runtime.data.requestId,
            ok: true,
          },
          [result.port],
        );
        return;
      }
      params.child.postMessage({
        type: HostMessageTypes.BotRemoteWorkspaceRuntimePort,
        requestId: runtime.data.requestId,
        ok: false,
        error: result.error ?? "unknown",
      });
    })
    .catch((error: unknown) => {
      params.child.postMessage({
        type: HostMessageTypes.BotRemoteWorkspaceRuntimePort,
        requestId: runtime.data.requestId,
        ok: false,
        error: errorText(error),
      });
    });
  return true;
}

export function createBotRemoteWorkspaceHostHandlers(manager: {
  reconnectBotRemoteWorkspaceSession(
    win: BrowserWindow,
    request: {
      requestId: string;
      workspacePath: string;
      workspaceIdentity: string;
      target: RemoteTarget;
    },
  ): Promise<string>;
  hasRemoteWorkspaceSessionForTarget(
    win: BrowserWindow,
    target: RemoteTarget,
    workspace: { workspacePath: string; workspaceIdentity: string },
  ): boolean;
  createBotRemoteWorkspaceRuntimePort(
    win: BrowserWindow,
    request: {
      workspacePath: string;
      workspaceIdentity: string;
      target: RemoteTarget;
    },
  ): MessagePortMain;
}): BotRemoteWorkspaceHostHandlers {
  return {
    async handleBotRemoteWorkspaceReconnectRequest(request) {
      try {
        const sessionId = await manager.reconnectBotRemoteWorkspaceSession(request.win, {
          requestId: request.requestId,
          workspacePath: request.workspacePath,
          workspaceIdentity: request.workspaceIdentity,
          target: request.target,
        });
        if (!request.win.isDestroyed() && !request.win.webContents.isDestroyed()) {
          const payload: BotRemoteWorkspaceReconnectedEvent = {
            sessionId,
            workspacePath: request.workspacePath,
            workspaceIdentity: request.workspaceIdentity,
            target: request.target,
          };
          request.win.webContents.send(PlatformChannels.BotRemoteWorkspaceReconnected, payload);
        }
        return { ok: true, sessionId };
      } catch (error) {
        return { ok: false, error: errorText(error) };
      }
    },
    async handleBotRemoteWorkspaceConnectionStatusRequest(request) {
      return {
        ok: true,
        connected: manager.hasRemoteWorkspaceSessionForTarget(request.win, request.target, {
          workspacePath: request.workspacePath,
          workspaceIdentity: request.workspaceIdentity,
        }),
      };
    },
    async handleBotRemoteWorkspaceRuntimePortRequest(request) {
      try {
        return {
          ok: true,
          port: manager.createBotRemoteWorkspaceRuntimePort(request.win, {
            workspacePath: request.workspacePath,
            workspaceIdentity: request.workspaceIdentity,
            target: request.target,
          }),
        };
      } catch (error) {
        return { ok: false, error: errorText(error) };
      }
    },
  };
}

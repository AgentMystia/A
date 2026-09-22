import { BrowserWindow, MessageChannelMain } from "electron";
import type { MessagePortMain, UtilityProcess as ElectronUtilityProcess } from "electron";
import { HostMessageTypes } from "@zcode/shared";
import type { WebRemoteControlAttachedHost, WebRemoteControlLogger } from "./runtimeTypes.js";

interface SharedHostEntry {
  windowId: number;
  remoteSessionId?: string;
  port: MessagePortMain;
}

function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

export function createWebRemoteControlSharedHostAttachments(options: {
  windowHostProcessMap: Map<number, ElectronUtilityProcess>;
  logger: WebRemoteControlLogger;
  attachRemoteWorkspaceSessionHost: (params: {
    windowId: number;
    remoteSessionId: string;
    workspacePath: string;
    workspaceIdentity: string;
    workspaceKey: string;
    clientMode: "web-remote-replayable";
  }) => { process: ElectronUtilityProcess; port: MessagePortMain; remoteKind: string };
  createMessageChannel?: () => { port1: MessagePortMain; port2: MessagePortMain };
}) {
  let nextId = 0;
  const attachments = new Map<string, SharedHostEntry>();

  const createChannel = () => options.createMessageChannel?.() ?? new MessageChannelMain();

  const releaseAttachment = (attachmentId: string) => {
    const entry = attachments.get(attachmentId);
    if (!entry) return;
    attachments.delete(attachmentId);
    try {
      entry.port.close();
    } catch (error) {
      options.logger.warn("[web-remote-control] failed to close shared host attachment", {
        attachmentId,
        error,
      });
    }
  };

  const attachLocalHost = (windowId: number): WebRemoteControlAttachedHost => {
    const webContentsId = BrowserWindow.fromId(windowId)?.webContents.id ?? windowId;
    const process = options.windowHostProcessMap.get(webContentsId);
    if (!process) {
      throw codedError("DESKTOP_HOST_MISSING", `未找到桌面窗口 host process，windowId=${windowId}`);
    }
    const { port1, port2 } = createChannel();
    const attachmentId = `shared-host-attachment-${++nextId}`;
    process.postMessage(
      {
        type: HostMessageTypes.AttachServicePort,
        requestId: `shared-host-request-${nextId}`,
        attachmentId,
        clientMode: "web-remote-replayable",
        scope: { kind: "local" },
      },
      [port2],
    );
    attachments.set(attachmentId, { windowId, port: port1 });
    return { entryId: `desktop-host:${windowId}`, attachmentId, process, port: port1 };
  };

  return {
    async attachWorkspaceHost(
      windowId: number,
      target: {
        workspacePath: string;
        workspaceIdentity?: string;
        remoteSessionId?: string;
        kind: "local" | "remote";
      },
    ): Promise<WebRemoteControlAttachedHost> {
      if (target.kind === "local") return attachLocalHost(windowId);
      if (!target.remoteSessionId) {
        throw codedError("REMOTE_SESSION_MISSING", "远程 workspace bridge 缺少 remoteSessionId。");
      }
      const workspaceIdentity = target.workspaceIdentity?.trim();
      if (!workspaceIdentity) {
        throw codedError(
          "REMOTE_WORKSPACE_IDENTITY_MISSING",
          "远程 workspace bridge 缺少 workspaceIdentity，不能建立身份隔离。",
        );
      }
      const attached = options.attachRemoteWorkspaceSessionHost({
        windowId,
        remoteSessionId: target.remoteSessionId,
        workspacePath: target.workspacePath,
        workspaceIdentity,
        workspaceKey: workspaceIdentity || target.workspacePath,
        clientMode: "web-remote-replayable",
      });
      const attachmentId = `shared-host-attachment-${++nextId}`;
      attachments.set(attachmentId, {
        windowId,
        remoteSessionId: target.remoteSessionId,
        port: attached.port,
      });
      return {
        entryId: `remote-session-host:${target.remoteSessionId}`,
        attachmentId,
        process: attached.process,
        port: attached.port,
        remoteKind: attached.remoteKind,
      };
    },
    releaseAttachment,
    disposeWindow(windowId: number): void {
      for (const [attachmentId, entry] of Array.from(attachments)) {
        if (entry.windowId === windowId) releaseAttachment(attachmentId);
      }
    },
    disposeRemoteSession(remoteSessionId: string): void {
      for (const [attachmentId, entry] of Array.from(attachments)) {
        if (entry.remoteSessionId === remoteSessionId) releaseAttachment(attachmentId);
      }
    },
  };
}

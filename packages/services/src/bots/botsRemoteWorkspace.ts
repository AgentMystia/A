import { randomUUID } from "node:crypto";
import {
  HostResponseTypes,
  hostBotRemoteWorkspaceConnectionStatusResultMessageSchema,
  hostBotRemoteWorkspaceReconnectResultMessageSchema,
  hostBotRemoteWorkspaceRuntimePortMessageSchema,
  type PersistedWorkspaceSessionEntry,
  type RemoteTargetSnapshot,
} from "@zcode/shared";
import type { ICredentialService } from "../credential/credential.js";
import type { IModelSelectionService } from "../model-provider/providerFacadeServices.js";
import type { ISettingService } from "../setting/setting.js";
import type { IZCodeTaskService } from "../session/zcodeTaskService.js";
import type { ZCodeAgentAppRuntimePreferences } from "../zcode-agent/zcodeAgent.js";
import { CONNECTION_STATUS_TIMEOUT_MS, REMOTE_RUNTIME_TIMEOUT_MS } from "./botsConstants.js";
import {
  createRemoteRuntimeServicesFromPort,
  type MessagePortLikeInput,
  type RemoteRuntimeServicesFromPort,
} from "./botsRemoteRuntime.js";

export type BotHostParentPort = {
  on(event: "message", listener: (event: { data: unknown; ports?: MessagePortLikeInput[] }) => void): void;
  off?(event: "message", listener: (event: { data: unknown; ports?: MessagePortLikeInput[] }) => void): void;
  postMessage(message: unknown): void;
};

export interface BotRemoteWorkspaceRef {
  workspacePath: string;
  workspaceIdentity: string;
}

export type BotRemoteTarget = RemoteTargetSnapshot & {
  password?: string;
  privateKeyPassphrase?: string;
};

export interface IBotRemoteWorkspaceService {
  isConnected(workspace: BotRemoteWorkspaceRef): Promise<boolean>;
  ensureConnected(workspace: BotRemoteWorkspaceRef): Promise<{ ok: boolean; message?: string }>;
  getZCodeTaskService(workspace: BotRemoteWorkspaceRef): Promise<IZCodeTaskService | null>;
  getModelSelectionService(workspace: BotRemoteWorkspaceRef): Promise<IModelSelectionService | null>;
  syncAppRuntimePreferences(preferences: ZCodeAgentAppRuntimePreferences): Promise<void>;
  dispose(): void;
}

function workspaceKey(workspace: BotRemoteWorkspaceRef): string {
  return workspace.workspaceIdentity.trim() || workspace.workspacePath;
}

/** 发布包 host `createBotRemoteWorkspaceService`。 */
export function createBotRemoteWorkspaceService(options: {
  parentPort?: BotHostParentPort | null;
  settingService: ISettingService;
  credentialService: Pick<ICredentialService, "load">;
  createRuntimeServicesFromPort?: (port: MessagePortLikeInput) => RemoteRuntimeServicesFromPort;
}): IBotRemoteWorkspaceService | undefined {
  const parentPort = options.parentPort;
  if (!parentPort) {
    return undefined;
  }
  const hostPort: BotHostParentPort = parentPort;
  const connectedKeys = new Set<string>();
  const reconnectWaiters = new Map<
    string,
    (result: { ok: boolean; sessionId?: string; error?: string }) => void
  >();
  const statusWaiters = new Map<
    string,
    (result: { ok: boolean; connected?: boolean; error?: string }) => void
  >();
  const runtimeWaiters = new Map<
    string,
    (result: { ok: boolean; port?: MessagePortLikeInput; error?: string }) => void
  >();
  const runtimeServices = new Map<string, RemoteRuntimeServicesFromPort>();
  let preferences: ZCodeAgentAppRuntimePreferences | undefined;
  let preferencesGeneration = 0;

  const onMessage = (event: { data: unknown; ports?: MessagePortLikeInput[] }) => {
    const reconnect = hostBotRemoteWorkspaceReconnectResultMessageSchema.safeParse(event.data);
    if (reconnect.success) {
      const waiter = reconnectWaiters.get(reconnect.data.requestId);
      if (!waiter) {
        return;
      }
      reconnectWaiters.delete(reconnect.data.requestId);
      waiter({
        ok: reconnect.data.ok,
        sessionId: reconnect.data.sessionId,
        error: reconnect.data.error,
      });
      return;
    }
    const status = hostBotRemoteWorkspaceConnectionStatusResultMessageSchema.safeParse(event.data);
    if (status.success) {
      const waiter = statusWaiters.get(status.data.requestId);
      if (!waiter) {
        return;
      }
      statusWaiters.delete(status.data.requestId);
      waiter({
        ok: status.data.ok,
        connected: status.data.connected,
        error: status.data.error,
      });
      return;
    }
    const runtime = hostBotRemoteWorkspaceRuntimePortMessageSchema.safeParse(event.data);
    if (!runtime.success) {
      return;
    }
    const waiter = runtimeWaiters.get(runtime.data.requestId);
    if (!waiter) {
      return;
    }
    runtimeWaiters.delete(runtime.data.requestId);
    waiter({
      ok: runtime.data.ok,
      port: event.ports?.[0],
      error: runtime.data.error,
    });
  };
  hostPort.on("message", onMessage);

  async function buildRemoteTargetForWorkspace(
    workspace: BotRemoteWorkspaceRef,
  ): Promise<BotRemoteTarget | null> {
    const settings = await options.settingService.get();
    const identity = workspace.workspaceIdentity.trim();
    const remotes = ((settings.lastWorkspaceSession ?? []) as PersistedWorkspaceSessionEntry[]).filter(
      (entry) => entry.kind === "remote",
    );
    const matched =
      remotes.find((entry) => entry.workspaceIdentity === identity) ??
      remotes.find(
        (entry) => entry.workspacePath === workspace.workspacePath && entry.workspaceIdentity === identity,
      );
    if (!matched || matched.kind !== "remote") {
      return null;
    }
    if (matched.target.kind !== "ssh") {
      return matched.target;
    }
    return {
      kind: "ssh",
      host: matched.target.host,
      port: matched.target.port,
      username: matched.target.username,
      privateKeyPath: matched.target.privateKeyPath,
      password: matched.target.passwordCredentialKey
        ? ((await options.credentialService.load(matched.target.passwordCredentialKey)) ?? undefined)
        : undefined,
      privateKeyPassphrase: matched.target.privateKeyPassphraseCredentialKey
        ? ((await options.credentialService.load(matched.target.privateKeyPassphraseCredentialKey)) ??
          undefined)
        : undefined,
    };
  }

  async function queryMainConnectionStatus(input: {
    workspacePath: string;
    workspaceIdentity: string;
    remoteTarget: BotRemoteTarget;
  }): Promise<boolean | null> {
    const requestId = `bot-status-${randomUUID()}`;
    const result = await new Promise<{ ok: boolean; connected?: boolean; error?: string }>((resolve) => {
      statusWaiters.set(requestId, resolve);
      hostPort.postMessage({
        type: HostResponseTypes.BotRemoteWorkspaceConnectionStatusRequest,
        requestId,
        workspacePath: input.workspacePath,
        workspaceIdentity: input.workspaceIdentity,
        target: input.remoteTarget,
      });
      setTimeout(() => {
        if (statusWaiters.delete(requestId)) {
          resolve({ ok: false, error: "远端 workspace 连接状态查询超时。" });
        }
      }, CONNECTION_STATUS_TIMEOUT_MS);
    });
    return result.ok ? result.connected === true : null;
  }

  async function getRuntimeServices(
    workspace: BotRemoteWorkspaceRef,
  ): Promise<RemoteRuntimeServicesFromPort | null> {
    const key = workspaceKey(workspace);
    const cached = runtimeServices.get(key);
    if (cached) {
      return cached;
    }
    const target = await buildRemoteTargetForWorkspace(workspace);
    if (!target) {
      return null;
    }
    const requestId = `bot-runtime-${randomUUID()}`;
    const result = await new Promise<{ ok: boolean; port?: MessagePortLikeInput; error?: string }>(
      (resolve) => {
        runtimeWaiters.set(requestId, resolve);
        hostPort.postMessage({
          type: HostResponseTypes.BotRemoteWorkspaceRuntimePortRequest,
          requestId,
          workspacePath: workspace.workspacePath,
          workspaceIdentity: workspace.workspaceIdentity,
          target,
        });
        setTimeout(() => {
          if (runtimeWaiters.delete(requestId)) {
            resolve({ ok: false, error: "远端 workspace runtime 初始化超时。" });
          }
        }, REMOTE_RUNTIME_TIMEOUT_MS);
      },
    );
    if (!result.ok || !result.port) {
      throw new Error(result.error ?? "远端 workspace runtime 初始化失败。");
    }
    const services =
      options.createRuntimeServicesFromPort?.(result.port) ?? createRemoteRuntimeServicesFromPort(result.port);
    for (;;) {
      const generation = preferencesGeneration;
      let next = preferences;
      if (!next) {
        const settings = await options.settingService.get();
        next = {
          askUserQuestionAutoResolutionEnabled: settings.askUserQuestionAutoResolutionEnabled !== false,
          modelIoFullRetentionEnabled: settings.modelIoFullRetentionEnabled === true,
        };
      }
      await services.zcodeAgentService.syncAppRuntimePreferences(next);
      if (generation === preferencesGeneration) {
        break;
      }
    }
    runtimeServices.set(key, services);
    return services;
  }

  return {
    async isConnected(workspace) {
      const key = workspaceKey(workspace);
      const target = await buildRemoteTargetForWorkspace(workspace);
      if (!target) {
        connectedKeys.delete(key);
        return false;
      }
      const connected = await queryMainConnectionStatus({ ...workspace, remoteTarget: target });
      if (connected !== null) {
        if (connected) {
          connectedKeys.add(key);
        } else {
          connectedKeys.delete(key);
        }
        return connected;
      }
      return connectedKeys.has(key);
    },
    async ensureConnected(workspace) {
      const target = await buildRemoteTargetForWorkspace(workspace);
      if (!target) {
        return { ok: false, message: "未找到该远端 workspace 的连接信息。" };
      }
      const requestId = `bot-reconnect-${randomUUID()}`;
      const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        reconnectWaiters.set(requestId, resolve);
        hostPort.postMessage({
          type: HostResponseTypes.BotRemoteWorkspaceReconnectRequest,
          requestId,
          workspacePath: workspace.workspacePath,
          workspaceIdentity: workspace.workspaceIdentity,
          target,
        });
        setTimeout(() => {
          if (reconnectWaiters.delete(requestId)) {
            resolve({ ok: false, error: "远端 workspace 重连超时。" });
          }
        }, REMOTE_RUNTIME_TIMEOUT_MS);
      });
      if (result.ok) {
        connectedKeys.add(workspaceKey(workspace));
        return { ok: true };
      }
      return { ok: false, message: result.error ?? "unknown" };
    },
    async getZCodeTaskService(workspace) {
      return (await getRuntimeServices(workspace))?.zcodeTaskService ?? null;
    },
    async getModelSelectionService(workspace) {
      return (await getRuntimeServices(workspace))?.modelSelectionService ?? null;
    },
    async syncAppRuntimePreferences(next) {
      preferences = next;
      preferencesGeneration += 1;
      await Promise.all(
        [...runtimeServices.values()].map((services) =>
          services.zcodeAgentService.syncAppRuntimePreferences(next),
        ),
      );
    },
    dispose() {
      hostPort.off?.("message", onMessage);
      reconnectWaiters.clear();
      runtimeWaiters.clear();
      statusWaiters.clear();
      runtimeServices.clear();
      connectedKeys.clear();
    },
  };
}

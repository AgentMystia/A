import { ChannelClient, MessagePortProtocol, ProxyChannel } from "@zcode/rpc";
import { IModelSelectionService } from "../model-provider/providerFacadeServices.js";
import { IZCodeTaskService } from "../session/zcodeTaskService.js";
import { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import { IZCodeSessionService } from "../zcode-session/zcodeSession.js";

export interface MessagePortLikeInput {
  addEventListener?(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener?(type: "message", listener: (event: { data: unknown }) => void): void;
  on?(type: "message", listener: (event: { data: unknown }) => void): void;
  off?(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
  start?(): void;
  close?(): void;
}

export interface RemoteRuntimeServicesFromPort {
  zcodeAgentService: IZCodeAgentService;
  zcodeTaskService: IZCodeTaskService;
  zcodeSessionService: IZCodeSessionService;
  modelSelectionService: IModelSelectionService;
}

/** 发布包 host `toMessagePortLike`：Node EventEmitter 与 DOM MessagePort 都能喂给 RPC。 */
export function toMessagePortLike(port: MessagePortLikeInput): {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
} {
  return {
    addEventListener(type, listener) {
      if (port.addEventListener) {
        port.addEventListener(type, listener);
        return;
      }
      port.on?.(type, listener);
    },
    removeEventListener(type, listener) {
      if (port.removeEventListener) {
        port.removeEventListener(type, listener);
        return;
      }
      port.off?.(type, listener);
    },
    postMessage(message) {
      port.postMessage(message);
    },
    start() {
      port.start?.();
    },
    close() {
      port.close?.();
    },
  };
}

/** 发布包 host `createRemoteRuntimeServicesFromPort`。 */
export function createRemoteRuntimeServicesFromPort(
  port: MessagePortLikeInput,
): RemoteRuntimeServicesFromPort {
  const protocol = new MessagePortProtocol(toMessagePortLike(port));
  const client = new ChannelClient(protocol);
  return {
    zcodeAgentService: ProxyChannel.toService<IZCodeAgentService>(
      client.getChannel(IZCodeAgentService.channelName),
    ),
    zcodeTaskService: ProxyChannel.toService<IZCodeTaskService>(
      client.getChannel(IZCodeTaskService.channelName),
    ),
    zcodeSessionService: ProxyChannel.toService<IZCodeSessionService>(
      client.getChannel(IZCodeSessionService.channelName),
    ),
    modelSelectionService: ProxyChannel.toService<IModelSelectionService>(
      client.getChannel(IModelSelectionService.channelName),
    ),
  };
}

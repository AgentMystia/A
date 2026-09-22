import { useSyncExternalStore } from "react";
import type { WebRemoteControlTerminalTransportState } from "@/web-remote/mobile/webRemoteControlMobileTypes.js";

// 发布包把传输快照放在模块变量里，初始 idle，styles 里没有写入点。
// 重连横幅仍引用 mobileShell.reconnecting，服务端快照只给 hydration。
let transportSnapshot: WebRemoteControlTerminalTransportState = "idle";
const transportListeners = new Set<() => void>();

function subscribeTransport(listener: () => void): () => void {
  transportListeners.add(listener);
  return () => {
    transportListeners.delete(listener);
  };
}

function getTransportSnapshot(): WebRemoteControlTerminalTransportState {
  return transportSnapshot;
}

export function useWebRemoteControlTerminalTransport(
  serverSnapshot: WebRemoteControlTerminalTransportState = "idle",
): WebRemoteControlTerminalTransportState {
  return useSyncExternalStore(subscribeTransport, getTransportSnapshot, () => serverSnapshot);
}

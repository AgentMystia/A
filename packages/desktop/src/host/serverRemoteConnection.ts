import { WebSocket, type RawData } from "ws";
import { Emitter, SocketProtocol, VSBuffer, type ISocket } from "@zcode/rpc";
import { connectViaProtocol } from "@zcode/client";
import type { IServiceAccessor } from "@zcode/services";
import {
  ZCODE_RPC_HOST_CAPABILITY_HEADER,
  serverRemoteHostCapabilitySchema,
  serverRemoteInfoSchema,
  type ServerConnectOptions,
  type ServerRemoteInfo,
} from "@zcode/shared";

/** 发布包 capability 与 info 请求的最小 fetch 面，测试可替换，默认用全局 fetch。 */
export interface ServerRemoteFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface ServerRemoteFetchInit {
  method?: string;
  headers?: Record<string, string>;
}

export type ServerRemoteFetch = (
  url: string,
  init?: ServerRemoteFetchInit,
) => Promise<ServerRemoteFetchResponse>;

export interface ServerRemoteConnectOptions {
  fetchImpl?: ServerRemoteFetch;
  onClose?: (event: { code: number; reason: string }) => void;
}

export interface ServerRemoteConnection {
  serverInfo: ServerRemoteInfo;
  services: IServiceAccessor;
  dispose(): void;
}

export interface ServerRemoteEndpoints {
  infoUrl: string;
  wsUrl: string;
  hostCapabilityUrl: string;
  hostWsUrl: string;
}

interface NodeWebSocketLike {
  readyState: number;
  send(data: Uint8Array): void;
  close(): void;
  on(event: "message", listener: (data: RawData) => void): void;
  on(event: "close", listener: (code: number, reason: Buffer) => void): void;
  on(event: "error", listener: (error: unknown) => void): void;
}

function appendEndpointPath(pathname: string, suffix: string): string {
  const base = pathname.replace(/\/+$/g, "");
  return base ? `${base}${suffix}` : suffix;
}

function stripWebSocketEndpointPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/g, "");
  // `/ws/host` 必须先于 `/ws` 去掉，否则 host 路径会被截成 `/host`。
  if (trimmed.endsWith("/ws/host")) return trimmed.slice(0, -8);
  if (trimmed.endsWith("/ws")) return trimmed.slice(0, -3);
  return trimmed;
}

export function resolveServerRemoteEndpoints(url: string): ServerRemoteEndpoints {
  const trimmed = url.trim();
  if (!trimmed) throw new Error("Server URL is required");
  const info = new URL(trimmed);
  const ws = new URL(trimmed);
  const capability = new URL(trimmed);
  const hostWs = new URL(trimmed);
  const infoPath = stripWebSocketEndpointPath(info.pathname);
  const wsPath = stripWebSocketEndpointPath(ws.pathname);
  const capabilityPath = stripWebSocketEndpointPath(capability.pathname);
  const hostWsPath = stripWebSocketEndpointPath(hostWs.pathname);
  switch (info.protocol) {
    case "http:":
    case "https:":
      ws.protocol = info.protocol === "https:" ? "wss:" : "ws:";
      hostWs.protocol = ws.protocol;
      break;
    case "ws:":
    case "wss:":
      info.protocol = info.protocol === "wss:" ? "https:" : "http:";
      capability.protocol = info.protocol;
      break;
    default:
      throw new Error(`Unsupported server URL protocol: ${info.protocol}`);
  }
  info.pathname = appendEndpointPath(infoPath, "/api/server-info");
  ws.pathname = appendEndpointPath(wsPath, "/ws");
  capability.pathname = appendEndpointPath(capabilityPath, "/api/rpc-host-capability");
  hostWs.pathname = appendEndpointPath(hostWsPath, "/ws/host");
  info.search = "";
  ws.search = "";
  capability.search = "";
  hostWs.search = "";
  info.hash = "";
  ws.hash = "";
  capability.hash = "";
  hostWs.hash = "";
  return {
    infoUrl: info.toString(),
    wsUrl: ws.toString(),
    hostCapabilityUrl: capability.toString(),
    hostWsUrl: hostWs.toString(),
  };
}

export function authenticatedUrl(url: string, target: { token?: string }): string {
  const token = target.token?.trim();
  if (!token) return url;
  const next = new URL(url);
  next.searchParams.set("token", token);
  return next.toString();
}

function bufferFromWebSocketData(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (Buffer.isBuffer(data)) return data;
  return Buffer.from(data);
}

export function wrapNodeWebSocket(
  socket: NodeWebSocketLike,
  onClose?: (event: { code: number; reason: string }) => void,
): ISocket {
  const onData = new Emitter<VSBuffer>();
  const onSocketClose = new Emitter<void>();
  const onEnd = new Emitter<void>();
  // error 没有 close code/reason。发布包只在 close 帧回调用户 onClose。
  const fireClosed = (code: number, reason: Buffer) => {
    onClose?.({ code, reason: reason.toString("utf8") });
    onSocketClose.fire();
    onEnd.fire();
  };
  socket.on("message", (data) => {
    const bytes = bufferFromWebSocketData(data);
    onData.fire(VSBuffer.wrap(new Uint8Array(bytes)));
  });
  socket.on("close", fireClosed);
  socket.on("error", () => {
    onSocketClose.fire();
    onEnd.fire();
  });
  return {
    onData: onData.event,
    onClose: onSocketClose.event,
    onEnd: onEnd.event,
    write(data) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data.buffer);
      }
    },
    end() {
      socket.close();
    },
    drain() {
      return Promise.resolve();
    },
    dispose() {
      socket.close();
    },
  };
}

export async function fetchServerInfo(
  infoUrl: string,
  target: { token?: string },
  fetchImpl: ServerRemoteFetch,
): Promise<ServerRemoteInfo> {
  const token = target.token?.trim();
  const response = await fetchImpl(authenticatedUrl(infoUrl, target), {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error(`Server info request failed: ${response.status}`);
  const payload = serverRemoteInfoSchema.safeParse(await response.json());
  if (!payload.success) throw new Error("Server info response is invalid");
  return payload.data;
}

export async function fetchHostCapability(
  capabilityUrl: string,
  target: { token?: string },
  fetchImpl: ServerRemoteFetch,
): Promise<string> {
  // 发布包 capability 不带 Authorization，token 只放在 query。
  const response = await fetchImpl(authenticatedUrl(capabilityUrl, target), { method: "POST" });
  if (!response.ok) throw new Error(`Host capability request failed: ${response.status}`);
  const payload = serverRemoteHostCapabilitySchema.safeParse(await response.json());
  if (!payload.success) throw new Error("Host capability response is invalid");
  return payload.data.capability;
}

function connectNodeWebSocket(
  url: string,
  target: { token?: string },
  capability: string,
  options: ServerRemoteConnectOptions,
): Promise<{ socket: WebSocket; services: IServiceAccessor }> {
  return new Promise((resolve, reject) => {
    const token = target.token?.trim();
    const socket = new WebSocket(authenticatedUrl(url, target), {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        [ZCODE_RPC_HOST_CAPABILITY_HEADER]: capability,
      },
    });
    let settled = false;
    socket.once("error", (error) => {
      if (!settled) reject(error);
    });
    socket.once("close", (code, reason) => {
      if (settled) return;
      reject(
        new Error(
          reason.length > 0
            ? `WebSocket closed before ready: ${reason.toString("utf8")}`
            : `WebSocket closed before ready (${code})`,
        ),
      );
    });
    socket.once("open", () => {
      settled = true;
      const wrapped = wrapNodeWebSocket(socket, options.onClose);
      resolve({ socket, services: connectViaProtocol(new SocketProtocol(wrapped)) });
    });
  });
}

export async function connectServerRemote(
  target: ServerConnectOptions,
  options: ServerRemoteConnectOptions = {},
): Promise<ServerRemoteConnection> {
  const endpoints = resolveServerRemoteEndpoints(target.url);
  const fetchImpl = options.fetchImpl ?? fetch;
  const serverInfo = await fetchServerInfo(endpoints.infoUrl, target, fetchImpl);
  const capability = await fetchHostCapability(endpoints.hostCapabilityUrl, target, fetchImpl);
  const { socket, services } = await connectNodeWebSocket(
    endpoints.hostWsUrl,
    target,
    capability,
    options,
  );
  return {
    serverInfo,
    services,
    dispose() {
      socket.close();
    },
  };
}

/**
 * 进程 backend 连接有 disposeAndWait。server websocket 只有 dispose。
 * abort 时若一律调用 disposeAndWait，server 分支会在类型和运行时都失败。
 */
export async function disposeHostRemoteConnection(
  connection:
    | { disposeAndWait(options: { timeoutMs: number }): Promise<void> }
    | { dispose(): void },
): Promise<void> {
  if ("disposeAndWait" in connection) {
    await connection.disposeAndWait({ timeoutMs: 5_000 });
    return;
  }
  connection.dispose();
}

import type { RemoteTarget } from "./remoteTarget.js";
import { buildSshRemoteHostKey } from "./remoteSshHostKey.js";

/**
 * 比较 server endpoint 时去掉凭据查询串、hash，并把 websocket 协议收成 http(s)。
 * `/ws` 后缀属于传输路径，不参与环境身份。
 */
export function normalizeServerEndpoint(url: string): string {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol === "ws:") parsed.protocol = "http:";
    if (parsed.protocol === "wss:") parsed.protocol = "https:";
    parsed.hash = "";
    parsed.search = "";
    const normalizedPath = parsed.pathname.replace(/\/+$/gu, "");
    parsed.pathname = normalizedPath.endsWith("/ws")
      ? normalizedPath.slice(0, -"/ws".length) || "/"
      : normalizedPath || "/";
    return parsed.toString().replace(/\/$/gu, "");
  } catch {
    return url.trim().replace(/\/+$/gu, "");
  }
}

/**
 * Provider Provisioning 等 Environment 级状态的稳定身份；不得混用 workspace/session 身份。
 */
export function buildRemoteEnvironmentKey(target: RemoteTarget): string {
  switch (target.kind) {
    case "ssh":
      return `ssh:${buildSshRemoteHostKey(target)}`;
    case "wsl":
      return `wsl:${target.distro?.trim() || "<default>"}\0${target.user?.trim() || "<default>"}`;
    case "docker":
      return `docker:${target.container.trim()}`;
    case "server":
      return `server:${target.serverId?.trim() || normalizeServerEndpoint(target.url)}`;
  }
}

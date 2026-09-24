import type { RemoteTarget } from "@zcode/shared";

/**
 * 发布包 main 的 server 比较和遥测键。
 * 规则与共享 `normalizeServerEndpoint` 相同，但正则必须是 `/g`：共享函数带 `u` 标志，给环境键和 host 使用，不能改。
 */
export function normalizeServerRemoteUrlForComparison(url: string): string {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol === "ws:") parsed.protocol = "http:";
    if (parsed.protocol === "wss:") parsed.protocol = "https:";
    parsed.hash = "";
    parsed.search = "";
    const normalizedPath = parsed.pathname.replace(/\/+$/g, "");
    parsed.pathname = normalizedPath.endsWith("/ws")
      ? normalizedPath.slice(0, -"/ws".length) || "/"
      : normalizedPath || "/";
    return parsed.toString().replace(/\/$/g, "");
  } catch {
    return url.trim().replace(/\/+$/g, "");
  }
}

/**
 * 发布包 `isSameRemoteTarget`。
 * server 只比较 URL，不比较 serverId、name 或 token。
 */
export function isSameRemoteTarget(left: RemoteTarget, right: RemoteTarget): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "ssh":
      return (
        right.kind === "ssh" &&
        left.host.trim().toLowerCase() === right.host.trim().toLowerCase() &&
        (left.port ?? 22) === (right.port ?? 22) &&
        left.username.trim() === right.username.trim() &&
        (left.privateKeyPath ?? "") === (right.privateKeyPath ?? "")
      );
    case "wsl":
      return (
        right.kind === "wsl" &&
        (left.distro?.trim() || "default") === (right.distro?.trim() || "default") &&
        (left.user?.trim() ?? "") === (right.user?.trim() ?? "")
      );
    case "docker":
      return right.kind === "docker" && left.container === right.container;
    case "server":
      return (
        right.kind === "server" &&
        normalizeServerRemoteUrlForComparison(left.url) ===
          normalizeServerRemoteUrlForComparison(right.url)
      );
  }
}

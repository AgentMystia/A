export type ProviderConfigServiceScope = "workspace" | "base";

export function selectProviderConfigTaskService<T>(input: {
  configuredServiceScope: ProviderConfigServiceScope;
  workspaceZCodeService: T | null;
  baseZCodeService: T | null;
  remoteSessionId: string | null;
}): T | null {
  if (input.configuredServiceScope === "workspace") {
    return input.workspaceZCodeService;
  }
  if (input.baseZCodeService) {
    return input.baseZCodeService;
  }
  if (input.remoteSessionId) {
    return null;
  }
  return input.workspaceZCodeService;
}

export function resolveProviderConfigLogScope(input: {
  configuredServiceScope: ProviderConfigServiceScope;
  remoteSessionId: string | null;
  workspaceZCodeService: unknown;
  baseZCodeService: unknown;
}): "base" | "remote" {
  if (input.configuredServiceScope === "base") {
    return "base";
  }
  if (input.remoteSessionId && input.workspaceZCodeService !== input.baseZCodeService) {
    return "remote";
  }
  return "base";
}

/** workspaceIdentity 已表示远程、但会话 id 尚未解析时不发配置路径请求。 */
export function isProviderConfigQueryReady(input: {
  workspaceIdentity?: string;
  remoteSessionId: string | null;
}): boolean {
  const remoteLike = Boolean(input.workspaceIdentity?.trim() || input.remoteSessionId?.trim());
  return !remoteLike || Boolean(input.remoteSessionId?.trim());
}

/**
 * exists 为 false 时打开父目录。盘符根保持 `X:\\`，与发布包菜单打开目标一致。
 */
export function resolveProviderConfigOpenPath(path: string, exists: boolean): string {
  if (exists) {
    return path;
  }
  const trimmed = path.replace(/[\\/]+$/, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (slash < 0) {
    return path;
  }
  if (slash === 0) {
    return trimmed[0] ?? path;
  }
  const parent = trimmed.slice(0, slash);
  if (/^[A-Za-z]:$/.test(parent)) {
    return `${parent}\\`;
  }
  return parent || path;
}

import { ZCODE_AGENT_PROVIDER, type ZCodeProvider } from "@zcode/shared";

export interface WorkspaceProviderConfigFile {
  provider: ZCodeProvider;
  path: string;
  exists: false;
}

/**
 * 发布包 host 的 getWorkspaceProviderConfigFile 不读取磁盘。
 * 它固定回 glm 与 workspacePath，并由 exists=false 让菜单打开父目录。
 * 请求里的 provider 不能在这里另做配置文件探测。
 */
export function readWorkspaceProviderConfigFile(params: {
  workspacePath: string;
}): WorkspaceProviderConfigFile {
  return {
    provider: ZCODE_AGENT_PROVIDER,
    path: params.workspacePath,
    exists: false,
  };
}

import type {
  LoadCliMcpFromUserDirectoryRequest,
  MigrateLegacyCommonMcpRequest,
  SaveCliMcpToUserDirectoryRequest,
} from "@zcode/shared";
import {
  isDockerDaemonAvailable,
  listAvailableDockerContainers,
  listAvailableWSLDistros,
  listSSHConfigAliases,
} from "../desktopRuntimeEnv.js";
import {
  loadCliMcpFromUserDirectory,
  migrateLegacyCommonMcp,
  saveCliMcpToUserDirectory,
} from "../mcpUserDirectory/index.js";
import type { WebRemoteControlLogger, WebRemoteControlPlatformMethod } from "./runtimeTypes.js";

function asRequest<T>(args: unknown): T | undefined {
  return typeof args === "object" && args !== null ? (args as T) : undefined;
}

export function createWebRemoteControlPlatformHandlers(logger: WebRemoteControlLogger): {
  [Method in WebRemoteControlPlatformMethod]: (args: unknown) => unknown;
} {
  return {
    isDockerAvailable: () => isDockerDaemonAvailable(),
    listWSLDistros: () => listAvailableWSLDistros(),
    listDockerContainers: () => listAvailableDockerContainers(),
    listSSHConfigAliases: () => listSSHConfigAliases(),
    loadMcpFromUserDirectory: (args) =>
      loadCliMcpFromUserDirectory(asRequest<LoadCliMcpFromUserDirectoryRequest>(args)),
    saveMcpToUserDirectory: async (args) => {
      try {
        const request = asRequest<SaveCliMcpToUserDirectoryRequest>(args);
        if (!request) throw new Error("Missing MCP save request");
        await saveCliMcpToUserDirectory(request);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("[web-remote-control] MCP save failed", message);
        return { success: false, error: message };
      }
    },
    migrateLegacyCommonMcp: (args) =>
      migrateLegacyCommonMcp(asRequest<MigrateLegacyCommonMcpRequest>(args)),
  };
}

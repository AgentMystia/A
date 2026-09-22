import type { BotRuntimeState, BotsState } from "@zcode/shared";
import type { IBotRemoteWorkspaceService } from "./botsRemoteWorkspace.js";

/** 发布包 host `writeContext`：bot-state 的唯一写入。 */
export async function writeContext(
  repo: {
    readState(): Promise<BotsState>;
    writeState(state: BotsState): Promise<unknown>;
  },
  context: BotRuntimeState,
): Promise<BotRuntimeState> {
  const state = await repo.readState();
  const next = { ...context, updatedAt: Date.now() };
  state.bots[context.botId] = next;
  await repo.writeState(state);
  return next;
}

/** 发布包 host `isRemoteWorkspaceConnected`。 */
export async function isRemoteWorkspaceConnected(
  remoteWorkspaceService: Pick<IBotRemoteWorkspaceService, "isConnected"> | undefined,
  context: Pick<BotRuntimeState, "workspacePath" | "workspaceIdentity">,
): Promise<boolean> {
  if (!context.workspaceIdentity) {
    return true;
  }
  if (!remoteWorkspaceService) {
    return false;
  }
  return remoteWorkspaceService
    .isConnected({
      workspacePath: context.workspacePath,
      workspaceIdentity: context.workspaceIdentity,
    })
    .catch(() => false);
}

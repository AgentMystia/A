import type { BotRuntimeState, BotsState } from "@zcode/shared";
import type { IBotRemoteWorkspaceService } from "./botsRemoteWorkspace.js";

type BotStateRepo = {
  readState(): Promise<BotsState>;
  writeState(state: BotsState): Promise<unknown>;
};

/** 发布包 host `writeContext`：bot-state 的唯一写入。依赖从 owner 读取，避免 runtime 上再挂 persistContext。 */
export async function writeContext(
  owner: { repo: BotStateRepo },
  context: BotRuntimeState,
): Promise<BotRuntimeState> {
  const state = await owner.repo.readState();
  const next = { ...context, updatedAt: Date.now() };
  state.bots[context.botId] = next;
  await owner.repo.writeState(state);
  return next;
}

/** 发布包 host `isRemoteWorkspaceConnected`。依赖从 owner 读取，避免 runtime 上再挂 isRemoteConnected。 */
export async function isRemoteWorkspaceConnected(
  owner: {
    remoteWorkspaceService?: Pick<IBotRemoteWorkspaceService, "isConnected">;
  },
  context: Pick<BotRuntimeState, "workspacePath" | "workspaceIdentity">,
): Promise<boolean> {
  if (!context.workspaceIdentity) {
    return true;
  }
  if (!owner.remoteWorkspaceService) {
    return false;
  }
  return owner.remoteWorkspaceService
    .isConnected({
      workspacePath: context.workspacePath,
      workspaceIdentity: context.workspaceIdentity,
    })
    .catch(() => false);
}

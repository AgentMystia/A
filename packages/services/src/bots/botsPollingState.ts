import type { BotWorkspaceRef } from "@zcode/shared";
import { findBot, firstAllowedWorkspace } from "./botsNormalize.js";
import type { BotsRepo } from "./botsRepo.js";

async function writeBotPollingField(
  repo: BotsRepo,
  listWorkspaces: () => Promise<BotWorkspaceRef[]>,
  botId: string,
  patch: { telegramOffset?: number; weixinGetUpdatesBuf?: string },
): Promise<void> {
  const state = await repo.readState();
  const existing = state.bots[botId];
  if (existing) {
    state.bots[botId] = { ...existing, ...patch, updatedAt: Date.now() };
  } else {
    const bot = findBot(await repo.readConfig(), botId);
    const workspace = bot ? firstAllowedWorkspace(await listWorkspaces(), bot) : null;
    if (bot && workspace) {
      state.bots[botId] = {
        botId,
        workspacePath: workspace.workspacePath,
        workspaceIdentity: workspace.workspaceIdentity,
        workspaceId: workspace.id,
        mode: "draft",
        activeTaskId: null,
        ...patch,
        updatedAt: Date.now(),
      };
    }
  }
  await repo.writeState(state);
}

export function createBotPollingState(repo: BotsRepo, listWorkspaces: () => Promise<BotWorkspaceRef[]>) {
  return {
    async readTelegramOffset(botId: string) {
      return (await repo.readState()).bots[botId]?.telegramOffset;
    },
    writeTelegramOffset(botId: string, offset: number) {
      return writeBotPollingField(repo, listWorkspaces, botId, { telegramOffset: offset });
    },
    async readWeixinGetUpdatesBuf(botId: string) {
      return (await repo.readState()).bots[botId]?.weixinGetUpdatesBuf;
    },
    writeWeixinGetUpdatesBuf(botId: string, buf: string) {
      return writeBotPollingField(repo, listWorkspaces, botId, { weixinGetUpdatesBuf: buf });
    },
  };
}

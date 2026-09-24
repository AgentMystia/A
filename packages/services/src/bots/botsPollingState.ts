import type { BotWorkspaceRef } from "@zcode/shared";
import { findBot, firstAllowedWorkspace } from "./botsNormalize.js";
import type { BotsRepo } from "./botsRepo.js";

const writeBotPollingField = (() => {
  return async (
    repo: BotsRepo,
    listWorkspaces: () => Promise<BotWorkspaceRef[]>,
    botId: string,
    patch: { telegramOffset?: number; weixinGetUpdatesBuf?: string },
  ): Promise<void> => {
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
  };
})();

export const createBotPollingState = (() => {
  return (
    repo: BotsRepo,
    listWorkspaces: () => Promise<BotWorkspaceRef[]>,
  ): {
    readTelegramOffset(botId: string): Promise<number | undefined>;
    writeTelegramOffset(botId: string, offset: number): Promise<void>;
    readWeixinGetUpdatesBuf(botId: string): Promise<string | undefined>;
    writeWeixinGetUpdatesBuf(botId: string, buf: string): Promise<void>;
  } => {
    // 发布包 keepNames 只落在具名函数上。
    async function readTelegramOffset(botId: string) {
      return (await repo.readState()).bots[botId]?.telegramOffset;
    }
    function writeTelegramOffset(botId: string, offset: number) {
      return writeBotPollingField(repo, listWorkspaces, botId, { telegramOffset: offset });
    }
    async function readWeixinGetUpdatesBuf(botId: string) {
      return (await repo.readState()).bots[botId]?.weixinGetUpdatesBuf;
    }
    function writeWeixinGetUpdatesBuf(botId: string, buf: string) {
      return writeBotPollingField(repo, listWorkspaces, botId, { weixinGetUpdatesBuf: buf });
    }
    return {
      readTelegramOffset,
      writeTelegramOffset,
      readWeixinGetUpdatesBuf,
      writeWeixinGetUpdatesBuf,
    };
  };
})();

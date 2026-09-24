import { buildBotCredentialKey, buildBotWebhookSecretKey } from "@zcode/shared/botsDefaults";
import {
  ALL_WORKSPACES,
  BOT_BIND_CODE_TTL_MS,
  isFeishuBotProvider,
  type BotBindCodeResult,
  type BotConfigEntry,
  type BotsConfig,
  type SaveBotRequest,
} from "@zcode/shared";
import type { ICredentialService } from "../credential/credential.js";
import type { ServiceLogger } from "../logger/serviceLogger.js";
import { createBotBindCode } from "./botsBindCode.js";
import { FEISHU_RESOLVE_NAME_DELAYS_MS } from "./botsConstants.js";
import { delay } from "./botsHttp.js";
import type { BotBindCodeRecord } from "./botsInbound.js";
import {
  findBot,
  normalizeBotConfig,
  normalizeAllowedWorkspaces,
  validateBotConfig,
} from "./botsNormalize.js";
import type { BotsRepo } from "./botsRepo.js";
import type { BotProvider } from "./botsTypes.js";

export const createBotsMutationApi = (() => {
  return (deps: {
    repo: BotsRepo;
    credentialService: ICredentialService;
    logger: ServiceLogger;
    providers: Record<string, BotProvider | null>;
    bindCodes: Map<string, BotBindCodeRecord>;
    refreshRuntimes(config?: BotsConfig): void;
    stopTelegram(bot: BotConfigEntry): Promise<void>;
    stopFeishu(botId: string): Promise<void>;
    stopWeixin(botId: string): Promise<void>;
  }) => {
    return {
      async saveBot(request: SaveBotRequest) {
        const config = await deps.repo.readConfig();
        let bot = normalizeBotConfig({
          ...request.bot,
          id: request.bot.id.trim(),
          name: request.bot.name.trim(),
        });
        if (request.credentialValue?.trim()) {
          const credentialRef = buildBotCredentialKey(bot.id);
          await deps.credentialService.save(credentialRef, request.credentialValue.trim());
          bot = { ...bot, credentialRef };
        }
        if (request.webhookSecretValue?.trim()) {
          const webhookSecretRef = buildBotWebhookSecretKey(bot.id);
          await deps.credentialService.save(webhookSecretRef, request.webhookSecretValue.trim());
          bot = { ...bot, webhookSecretRef };
        }
        if (request.credentialValue?.trim() || !bot.name.trim()) {
          const delays = isFeishuBotProvider(bot.provider)
            ? FEISHU_RESOLVE_NAME_DELAYS_MS
            : ([0] as const);
          let resolved: string | null = null;
          let lastError: unknown;
          for (const waitMs of delays) {
            if (waitMs > 0) {
              await delay(waitMs);
            }
            try {
              resolved = (await deps.providers[bot.provider]?.resolveName?.(bot)) ?? null;
              if (resolved?.trim()) {
                break;
              }
            } catch (error) {
              lastError = error;
            }
          }
          if (resolved?.trim()) {
            bot = { ...bot, name: resolved.trim() };
          } else if (lastError) {
            deps.logger.warn(
              undefined,
              `resolve bot name failed bot=${bot.id}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
            );
          }
        }
        bot = normalizeBotConfig(bot);
        validateBotConfig(config, bot);
        const next = await deps.repo.writeConfig({
          ...config,
          bots: [...config.bots.filter((item) => item.id !== bot.id), bot],
        });
        deps.refreshRuntimes(next);
        return bot;
      },
      async removeBotSecret(botId: string) {
        const config = await deps.repo.readConfig();
        const bot = findBot(config, botId);
        if (!bot) {
          throw new Error(`Bot not found: ${botId}`);
        }
        if (bot.provider === "telegram") {
          await deps.stopTelegram({ ...bot, enabled: false });
        }
        if (isFeishuBotProvider(bot.provider)) {
          await deps.stopFeishu(bot.id);
        }
        if (bot.provider === "weixin") {
          await deps.stopWeixin(bot.id);
        }
        const nextBot = normalizeBotConfig({
          ...bot,
          credentialRef: undefined,
          webhookSecretRef: undefined,
          providerUserId: undefined,
          displayName: undefined,
          feishuAppId: isFeishuBotProvider(bot.provider) ? undefined : bot.feishuAppId,
        });
        const next = await deps.repo.writeConfig({
          ...config,
          bots: config.bots.map((item) => (item.id === bot.id ? nextBot : item)),
        });
        const state = await deps.repo.readState();
        delete state.bots[bot.id];
        await deps.repo.writeState(state);
        deps.refreshRuntimes(next);
        if (bot.credentialRef) {
          await deps.credentialService.delete(bot.credentialRef);
        }
        if (bot.webhookSecretRef) {
          await deps.credentialService.delete(bot.webhookSecretRef);
        }
        return nextBot;
      },
      async deleteBot(botId: string) {
        const config = await deps.repo.readConfig();
        const bot = findBot(config, botId);
        if (bot?.provider === "telegram") {
          await deps.stopTelegram({ ...bot, enabled: false });
        }
        if (bot && isFeishuBotProvider(bot.provider)) {
          await deps.stopFeishu(bot.id);
        }
        if (bot?.provider === "weixin") {
          await deps.stopWeixin(bot.id);
        }
        await deps.repo.writeConfig({
          ...config,
          bots: config.bots.filter((item) => item.id !== botId),
        });
        const state = await deps.repo.readState();
        delete state.bots[botId];
        await deps.repo.writeState(state);
        deps.refreshRuntimes();
        if (bot?.credentialRef) {
          await deps.credentialService.delete(bot.credentialRef);
        }
        if (bot?.webhookSecretRef) {
          await deps.credentialService.delete(bot.webhookSecretRef);
        }
      },
      async testBot(botId: string) {
        const bot = findBot(await deps.repo.readConfig(), botId);
        if (!bot) {
          return { ok: false, message: "Bot not found.", provider: "telegram" as const };
        }
        const provider = deps.providers[bot.provider];
        return provider
          ? { ...(await provider.test(bot)), provider: bot.provider }
          : {
              ok: false,
              message: `${bot.provider} is reserved for a future version.`,
              provider: bot.provider,
            };
      },
      async createBindCode(request: {
        botId: string;
        ttlMs?: number;
        allowedWorkspaces?: string[];
      }): Promise<BotBindCodeResult> {
        const botId = request.botId?.trim();
        if (!botId) {
          throw new Error("Bot id is required.");
        }
        if (!findBot(await deps.repo.readConfig(), botId)) {
          throw new Error(`Bot not found: ${botId}`);
        }
        const code = createBotBindCode();
        const expiresAt = Date.now() + (request.ttlMs ?? BOT_BIND_CODE_TTL_MS);
        deps.bindCodes.set(code, {
          botId,
          code,
          allowedWorkspaces: normalizeAllowedWorkspaces(
            request.allowedWorkspaces ?? [ALL_WORKSPACES],
          ),
          expiresAt,
        });
        return { code, expiresAt };
      },
    };
  };
})();

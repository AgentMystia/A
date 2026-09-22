import type { BotActor, BotConfigEntry, BotProviderOutbound } from "@zcode/shared";
import type { ServiceLogger } from "../logger/serviceLogger.js";
import { getActorContextKey } from "./botsInboundText.js";
import type { BotProvider } from "./botsTypes.js";

export interface TransientInteractionCardEntry {
  bot: BotConfigEntry;
  taskId: string;
  handle: { providerMessageId: string };
}

/** 发布包 host `upsertTransientInteractionCard`。 */
export async function upsertTransientInteractionCard(
  providers: Record<string, BotProvider | null>,
  cards: Map<string, TransientInteractionCardEntry>,
  bot: BotConfigEntry,
  actor: BotActor,
  taskId: string,
  message: BotProviderOutbound,
): Promise<void> {
  const provider = providers[bot.provider];
  const key = getActorContextKey(actor);
  const existing = cards.get(key);
  if (existing) {
    await provider?.updateTransientInteractionCard?.(existing.bot, existing.handle, message);
    return;
  }
  const created = await provider?.createTransientInteractionCard?.(bot, message);
  if (created) {
    cards.set(key, { bot, taskId, handle: created });
  }
}

/** 发布包 host `finalizeTransientInteractionCard`。 */
export async function finalizeTransientInteractionCard(
  providers: Record<string, BotProvider | null>,
  cards: Map<string, TransientInteractionCardEntry>,
  logger: Pick<ServiceLogger, "warn">,
  actor: BotActor,
  message: BotProviderOutbound,
): Promise<boolean> {
  const key = getActorContextKey(actor);
  const existing = cards.get(key);
  if (!existing) {
    return false;
  }
  const provider = providers[existing.bot.provider];
  try {
    await provider?.updateTransientInteractionCard?.(existing.bot, existing.handle, message);
  } catch (error) {
    logger.warn(
      undefined,
      `finalize interaction card failed bot=${existing.bot.id} task=${existing.taskId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    cards.delete(key);
  }
  return true;
}

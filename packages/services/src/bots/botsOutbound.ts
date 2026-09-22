import type {
  BotActor,
  BotConfigEntry,
  BotOutboundMessage,
  BotProviderOutbound,
} from "@zcode/shared";
import type { BotProvider } from "./botsTypes.js";

/** 发布包 host `createOutbound`。 */
export function createOutbound(
  actor: BotActor,
  text: string,
  selection?: unknown,
  extra: Partial<BotProviderOutbound> = {},
): BotProviderOutbound {
  return {
    botId: actor.botId,
    provider: actor.provider,
    providerUserId: actor.chatId ?? actor.providerUserId,
    text,
    ...(selection ? { selection } : {}),
    ...extra,
    ...(actor.providerContextToken ? { providerContextToken: actor.providerContextToken } : {}),
  };
}

export function toOutboundMessages(actor: BotActor, replies: BotProviderOutbound[]): BotOutboundMessage[] {
  return replies.map((reply) => ({
    actor,
    text: reply.text,
    selection: reply.selection,
    elicitation: reply.elicitation,
    locale: reply.locale,
  }));
}

export async function sendOutbound(
  provider: BotProvider | null | undefined,
  bot: BotConfigEntry,
  outbound: BotProviderOutbound,
): Promise<void> {
  if (provider) {
    await provider.send(bot, outbound);
  }
}

export function summarizeCallbackPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload).slice(0, 500);
  } catch {
    return String(payload);
  }
}

/** 发布包 host `enqueueInboundProcessing`：同一 actor 串行。 */
export function createInboundQueue(): {
  enqueue<T>(actor: BotActor, run: () => Promise<T>): Promise<T>;
} {
  const queues = new Map<string, Promise<unknown>>();
  const actorKey = (actor: BotActor) =>
    [actor.botId, actor.provider, actor.chatId?.trim() || actor.providerUserId].join("::");
  return {
    async enqueue(actor, run) {
      const key = actorKey(actor);
      const previous = queues.get(key) ?? Promise.resolve();
      let release: () => void = () => undefined;
      const gate = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => {
        release = resolve;
      }));
      queues.set(key, gate);
      await previous.catch(() => undefined);
      try {
        return await run();
      } finally {
        release();
        if (queues.get(key) === gate) {
          queues.delete(key);
        }
      }
    },
  };
}

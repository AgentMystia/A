import type {
  BotActor,
  BotConfigEntry,
  BotOutboundMessage,
  BotProviderOutbound,
} from "@zcode/shared";
import { getActorContextKey } from "./botsInboundText.js";
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

export function toOutboundMessages(
  actor: BotActor,
  replies: BotProviderOutbound[],
): BotOutboundMessage[] {
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

// 发布包把队列放在模块级。工厂会留下 createInboundQueue，内部箭头也留不下 releaseQueue。
const inboundQueues = new Map<string, Promise<unknown>>();

/** 发布包 host `enqueueInboundProcessing`：同一 actor 串行。 */
export async function enqueueInboundProcessing<T>(
  actor: BotActor,
  run: () => Promise<T>,
): Promise<T> {
  const key = getActorContextKey(actor);
  const previous = inboundQueues.get(key) ?? Promise.resolve();
  let releaseQueue: () => void = () => {};
  const gate = previous
    .catch(() => undefined)
    .then(
      () =>
        new Promise<void>((resolve) => {
          releaseQueue = resolve;
        }),
    );
  inboundQueues.set(key, gate);
  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    releaseQueue();
    if (inboundQueues.get(key) === gate) {
      inboundQueues.delete(key);
    }
  }
}

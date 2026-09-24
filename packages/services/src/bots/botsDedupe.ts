import type { BotInboundMessage } from "@zcode/shared";
import { INBOUND_DEDUPE_TTL_MS } from "./botsConstants.js";

/** 发布包 host `buildInboundDeliveryKey`。 */
export function buildInboundDeliveryKey(message: BotInboundMessage): string | null {
  const messageId = message.actor.providerMessageId?.trim();
  return messageId
    ? [
        message.actor.botId,
        message.actor.provider,
        message.actor.chatId ?? message.actor.providerUserId,
        messageId,
      ].join("::")
    : null;
}

/** 发布包 host `pruneRecentInboundDeliveryDedupe`。 */
export function pruneRecentInboundDeliveryDedupe(seen: Map<string, number>, now: number): void {
  for (const [key, at] of seen) {
    if (now - at >= INBOUND_DEDUPE_TTL_MS) {
      seen.delete(key);
    }
  }
}

/** 发布包 host `releaseInboundDelivery`。 */
export function releaseInboundDelivery(
  seen: Map<string, number>,
  message: BotInboundMessage,
): void {
  const key = buildInboundDeliveryKey(message);
  if (key) {
    seen.delete(key);
  }
}

/** 发布包 host `markInboundDelivery`。 */
export function markInboundDelivery(
  seen: Map<string, number>,
  message: BotInboundMessage,
): boolean {
  const now = Date.now();
  pruneRecentInboundDeliveryDedupe(seen, now);
  const key = buildInboundDeliveryKey(message);
  if (!key) {
    return true;
  }
  if (seen.has(key)) {
    return false;
  }
  seen.set(key, now);
  return true;
}

export const createInboundDeliveryDedupe = (() => {
  return (): {
    mark(message: BotInboundMessage): boolean;
    release(message: BotInboundMessage): void;
  } => {
    const seen = new Map<string, number>();
    return {
      mark(message) {
        return markInboundDelivery(seen, message);
      },
      release(message) {
        releaseInboundDelivery(seen, message);
      },
    };
  };
})();

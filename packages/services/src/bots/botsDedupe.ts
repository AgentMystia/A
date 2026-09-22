import type { BotInboundMessage } from "@zcode/shared";
import { INBOUND_DEDUPE_TTL_MS } from "./botsConstants.js";

/** 发布包 host `buildInboundDeliveryKey`。 */
export function buildInboundDeliveryKey(message: BotInboundMessage): string | null {
  const messageId = message.actor.providerMessageId?.trim();
  return messageId
    ? [message.actor.botId, message.actor.provider, message.actor.chatId ?? message.actor.providerUserId, messageId].join(
        "::",
      )
    : null;
}

export function createInboundDeliveryDedupe(): {
  mark(message: BotInboundMessage): boolean;
  release(message: BotInboundMessage): void;
} {
  const seen = new Map<string, number>();
  const prune = (now: number) => {
    for (const [key, at] of seen) {
      if (now - at >= INBOUND_DEDUPE_TTL_MS) {
        seen.delete(key);
      }
    }
  };
  return {
    mark(message) {
      const now = Date.now();
      prune(now);
      const key = buildInboundDeliveryKey(message);
      if (!key) {
        return true;
      }
      if (seen.has(key)) {
        return false;
      }
      seen.set(key, now);
      return true;
    },
    release(message) {
      const key = buildInboundDeliveryKey(message);
      if (key) {
        seen.delete(key);
      }
    },
  };
}

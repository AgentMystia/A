import type { BotMessageLocale } from "./botsCopy.js";
import { copy } from "./botsInboundText.js";

/** 发布包 host `isSessionExpiredError`。 */
export function isSessionExpiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\bSession (not found|is not active):/i.test(message);
}

/** 发布包 host `formatUserFacingBotError`。 */
export function formatUserFacingBotError(error: unknown, locale: BotMessageLocale): string {
  return isSessionExpiredError(error)
    ? copy(locale, "sessionExpiredNewTaskHint")
    : error instanceof Error
      ? error.message
      : String(error);
}

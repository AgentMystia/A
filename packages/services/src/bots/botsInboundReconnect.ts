import type { BotInboundMessage, BotOutboundMessage, BotRuntimeState } from "@zcode/shared";
import { RECONNECT_COOLDOWN_MS } from "./botsConstants.js";
import { copy, getActorContextKey } from "./botsInboundText.js";
import type { BotMessageLocale } from "./botsCopy.js";
import type { AuthorizedContext } from "./botsInbound.js";
import type { IBotRemoteWorkspaceService } from "./botsRemoteWorkspace.js";

export async function handleBotReconnect(input: {
  message: BotInboundMessage;
  authorized: AuthorizedContext;
  remoteWorkspaceService?: IBotRemoteWorkspaceService;
  isRemoteConnected(context: BotRuntimeState): Promise<boolean>;
  replies(actor: BotInboundMessage["actor"], text: string, locale?: BotMessageLocale): BotOutboundMessage[];
  reconnectInFlight: Map<string, Promise<BotOutboundMessage[]>>;
  reconnectCooldown: Map<string, number>;
}): Promise<BotOutboundMessage[]> {
  if (!input.authorized.ok) {
    return input.authorized.reply;
  }
  const { context, locale } = input.authorized;
  if (!context.workspaceIdentity) {
    return input.replies(input.message.actor, copy(locale, "remoteReconnectLocal"));
  }
  if (!input.remoteWorkspaceService) {
    return input.replies(
      input.message.actor,
      copy(locale, "remoteReconnectUnavailable", { workspacePath: context.workspacePath }),
    );
  }
  if (await input.isRemoteConnected(context)) {
    return input.replies(
      input.message.actor,
      copy(locale, "remoteReconnectAlreadyConnected", { workspacePath: context.workspacePath }),
    );
  }
  const key = `${getActorContextKey(input.message.actor)}::${context.workspaceIdentity}`;
  const now = Date.now();
  const cooldown = input.reconnectCooldown.get(key);
  if (cooldown !== undefined && now - cooldown < RECONNECT_COOLDOWN_MS) {
    return [];
  }
  const inflight = input.reconnectInFlight.get(key);
  if (inflight) {
    return inflight.catch(() => []);
  }
  const run = (async () => {
    const result = await input.remoteWorkspaceService!.ensureConnected({
      workspacePath: context.workspacePath,
      workspaceIdentity: context.workspaceIdentity!,
    });
    if (!result.ok) {
      return input.replies(
        input.message.actor,
        copy(locale, "remoteReconnectFailed", {
          workspacePath: context.workspacePath,
          message: result.message ?? "unknown",
        }),
      );
    }
    return input.replies(
      input.message.actor,
      copy(locale, "remoteReconnectAlreadyConnected", { workspacePath: context.workspacePath }),
    );
  })();
  input.reconnectInFlight.set(key, run);
  try {
    const repliesOut = await run;
    input.reconnectCooldown.set(key, Date.now());
    return repliesOut;
  } finally {
    input.reconnectInFlight.delete(key);
  }
}

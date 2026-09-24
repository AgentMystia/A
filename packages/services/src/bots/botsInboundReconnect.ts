import type { BotInboundMessage, BotOutboundMessage, BotRuntimeState } from "@zcode/shared";
import { INBOUND_DEDUPE_TTL_MS, RECONNECT_COOLDOWN_MS } from "./botsConstants.js";
import { copy, getActorContextKey } from "./botsInboundText.js";
import type { BotMessageLocale } from "./botsCopy.js";
import type { AuthorizedContext } from "./botsInbound.js";
import type { IBotRemoteWorkspaceService } from "./botsRemoteWorkspace.js";
import { getWorkspaceKey } from "./botsNormalize.js";
import { isRemoteWorkspaceConnected, writeContext } from "./botsContext.js";
import { buildInitializedDraftOptions } from "./botsDraft.js";
import type { BotsRepo } from "./botsRepo.js";

function buildRemoteReconnectCommandKey(
  actor: BotInboundMessage["actor"],
  context: Pick<BotRuntimeState, "workspacePath" | "workspaceIdentity">,
): string {
  return [
    actor.botId,
    actor.provider,
    actor.chatId ?? actor.providerUserId,
    getWorkspaceKey(context.workspacePath, context.workspaceIdentity),
  ].join("::");
}

function buildRemoteReconnectDeliveryKey(message: BotInboundMessage): string | null {
  const id = message.actor.providerMessageId?.trim();
  return id
    ? [
        message.actor.botId,
        message.actor.provider,
        message.actor.chatId ?? message.actor.providerUserId,
        id,
      ].join("::")
    : null;
}

function pruneRecentRemoteReconnectDeliveryDedupe(map: Map<string, number>, now: number): void {
  for (const [key, at] of map) {
    if (now - at >= INBOUND_DEDUPE_TTL_MS) {
      map.delete(key);
    }
  }
}

/** 发布包 host `performRemoteReconnect`。 */
export async function performRemoteReconnect(input: {
  message: BotInboundMessage;
  context: BotRuntimeState;
  locale: BotMessageLocale;
  remoteWorkspaceService?: IBotRemoteWorkspaceService;
  repo: BotsRepo;
  createStatusReply(
    actor: BotInboundMessage["actor"],
    context: BotRuntimeState,
    locale: BotMessageLocale,
  ): Promise<BotOutboundMessage[]>;
  replies(
    actor: BotInboundMessage["actor"],
    text: string,
    locale?: BotMessageLocale,
  ): BotOutboundMessage[];
}): Promise<BotOutboundMessage[]> {
  let result: { ok: boolean; message?: string };
  try {
    result = await reconnectRemoteWorkspaceForBot(input.remoteWorkspaceService, input.context);
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  if (!result.ok) {
    return input.replies(
      input.message.actor,
      copy(input.locale, "remoteReconnectFailed", {
        workspacePath: input.context.workspacePath,
        message: result.message ?? "unknown",
      }),
    );
  }
  if (input.context.mode === "draft" || !input.context.activeTaskId) {
    const draft = await buildInitializedDraftOptions(input.context, (item) =>
      isRemoteWorkspaceConnected(input, item),
    );
    await writeContext(input, { ...input.context, draftOptions: draft });
  }
  return input.createStatusReply(input.message.actor, input.context, input.locale);
}

/** 发布包 host `reconnectRemoteWorkspaceForBot`。 */
export async function reconnectRemoteWorkspaceForBot(
  remoteWorkspaceService: IBotRemoteWorkspaceService | undefined,
  context: Pick<BotRuntimeState, "workspacePath" | "workspaceIdentity">,
): Promise<{ ok: boolean; message?: string }> {
  if (!context.workspaceIdentity) {
    return { ok: true };
  }
  if (!remoteWorkspaceService) {
    return { ok: false, message: "remote reconnect service unavailable" };
  }
  return remoteWorkspaceService.ensureConnected({
    workspacePath: context.workspacePath,
    workspaceIdentity: context.workspaceIdentity,
  });
}

export async function handleBotReconnect(input: {
  message: BotInboundMessage;
  authorized: AuthorizedContext;
  remoteWorkspaceService?: IBotRemoteWorkspaceService;
  repo: BotsRepo;
  createStatusReply(
    actor: BotInboundMessage["actor"],
    context: BotRuntimeState,
    locale: BotMessageLocale,
  ): Promise<BotOutboundMessage[]>;
  replies(
    actor: BotInboundMessage["actor"],
    text: string,
    locale?: BotMessageLocale,
  ): BotOutboundMessage[];
  reconnectInFlight: Map<string, Promise<BotOutboundMessage[]>>;
  reconnectCooldown: Map<string, number>;
  reconnectDelivery: Map<string, number>;
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
  const now = Date.now();
  pruneRecentRemoteReconnectDeliveryDedupe(input.reconnectDelivery, now);
  const deliveryKey = buildRemoteReconnectDeliveryKey(input.message);
  if (deliveryKey && input.reconnectDelivery.has(deliveryKey)) {
    return [];
  }
  if (deliveryKey) {
    input.reconnectDelivery.set(deliveryKey, now);
  }
  const key = buildRemoteReconnectCommandKey(input.message.actor, context);
  const inflight = input.reconnectInFlight.get(key);
  if (inflight) {
    await inflight.catch(() => []);
    return [];
  }
  const cooldown = input.reconnectCooldown.get(key);
  if (cooldown !== undefined && now - cooldown < RECONNECT_COOLDOWN_MS) {
    return [];
  }
  if (await isRemoteWorkspaceConnected(input, context)) {
    return input.createStatusReply(input.message.actor, context, locale);
  }
  const run = performRemoteReconnect({
    message: input.message,
    context,
    locale,
    remoteWorkspaceService: input.remoteWorkspaceService,
    repo: input.repo,
    createStatusReply: input.createStatusReply,
    replies: input.replies,
  });
  input.reconnectInFlight.set(key, run);
  try {
    const repliesOut = await run;
    input.reconnectCooldown.set(key, Date.now());
    return repliesOut;
  } finally {
    input.reconnectInFlight.delete(key);
  }
}

export { buildRemoteReconnectCommandKey, getActorContextKey };

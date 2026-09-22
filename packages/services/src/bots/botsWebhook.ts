import type { BotConfigEntry, BotInboundMessage, BotProviderOutbound } from "@zcode/shared";
import { postWebhookWithRetry } from "./botsHttp.js";
import { isRecord } from "./botsJson.js";
import {
  WEBHOOK_ELICITATION_TYPE,
  WEBHOOK_MESSAGE_TYPE,
  WEBHOOK_SECRET_HEADER,
  WEBHOOK_TEST_TYPE,
} from "./botsConstants.js";
import type { BotCredentialLoader, BotProvider, BotSelection } from "./botsTypes.js";

function formatSelectionCommand(selection: BotSelection, optionId: string): string {
  if (selection.action === "permission.respond") {
    return optionId;
  }
  if (selection.action === "elicitation.respond") {
    return selection.token ? `/elicitation ${selection.token} ${optionId}` : `/elicitation ${optionId}`;
  }
  if (selection.action === "model.provider.set") {
    return `/model provider ${optionId}`;
  }
  if (selection.action === "model.set") {
    return `/model model ${optionId}`;
  }
  return `/${selection.action.replace(".set", "")} ${optionId}`;
}

/** 发布包 host `buildSelectionText`：把 inline selection 展开成可回复文本。 */
export function buildWebhookSelectionText(outbound: BotProviderOutbound): string {
  const selection = outbound.selection as BotSelection | undefined;
  if (!selection) {
    return outbound.text;
  }
  const lines = selection.options.map((option, index) => {
    const description = option.description ? ` - ${option.description}` : "";
    return `${index + 1}. ${option.label}${description}\n${formatSelectionCommand(selection, option.id)}`;
  });
  return `${outbound.text}\n${lines.join("\n")}`;
}

export function parseWebhookAttachment(
  value: unknown,
  index: number,
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = value.kind;
  if (kind !== "image" && kind !== "audio" && kind !== "video" && kind !== "file") {
    return null;
  }
  const id = typeof value.id === "string" && value.id.trim() ? value.id : `webhook-${index + 1}`;
  const filename =
    typeof value.filename === "string" && value.filename.trim() ? value.filename : `${id}.${kind}`;
  const mimeType =
    typeof value.mimeType === "string" && value.mimeType.trim()
      ? value.mimeType
      : "application/octet-stream";
  return {
    id,
    kind,
    filename,
    mimeType,
    ...(typeof value.sizeBytes === "number" ? { sizeBytes: value.sizeBytes } : {}),
    ...(typeof value.providerFileId === "string" ? { providerFileId: value.providerFileId } : {}),
    ...(typeof value.downloadUrl === "string" ? { downloadUrl: value.downloadUrl } : {}),
    ...(typeof value.dataBase64 === "string" ? { dataBase64: value.dataBase64 } : {}),
    ...(typeof value.localPath === "string" ? { localPath: value.localPath } : {}),
  };
}

export function parseWebhookAttachments(payload: Record<string, unknown>): unknown[] {
  return Array.isArray(payload.attachments)
    ? payload.attachments.map((item, index) => parseWebhookAttachment(item, index)).filter((item) => item !== null)
    : [];
}

export function parseWebhookElicitationResponse(payload: Record<string, unknown>): unknown {
  if (payload.type !== "zcode.bot.elicitation_response") {
    return undefined;
  }
  const requestId = typeof payload.requestId === "string" && payload.requestId.trim() ? payload.requestId : "";
  const action = payload.action;
  if (!requestId || (action !== "accept" && action !== "decline" && action !== "cancel")) {
    return undefined;
  }
  return {
    requestId,
    action,
    ...(isRecord(payload.content) ? { content: payload.content } : {}),
  };
}

function secretHeaderName(bot: BotConfigEntry): string {
  return bot.webhookAuthHeaderName || WEBHOOK_SECRET_HEADER;
}

export function createWebhookBotProvider(deps: BotCredentialLoader): BotProvider {
  return {
    async test(bot) {
      if (!bot.enabled) {
        return { ok: false, message: "Webhook bot is disabled." };
      }
      if (!bot.webhookSecretRef) {
        return {
          ok: false,
          message: "Webhook secret is missing. Configure a secret before exposing the callback endpoint.",
        };
      }
      if (bot.webhookUrl) {
        const secret = await deps.loadCredential(bot.webhookSecretRef);
        const response = await postWebhookWithRetry(bot.webhookUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [secretHeaderName(bot)]: secret ?? "",
          },
          body: JSON.stringify({
            type: WEBHOOK_TEST_TYPE,
            botId: bot.id,
            provider: "webhook",
            sentAt: Date.now(),
          }),
        });
        return {
          ok: response.ok,
          message: response.ok
            ? "Webhook outbound endpoint is reachable."
            : `Webhook outbound endpoint returned HTTP ${response.status}.`,
        };
      }
      return { ok: true, message: "Webhook bot is enabled for inbound callbacks." };
    },
    async send(bot, outbound) {
      if (!bot.webhookUrl) {
        return;
      }
      const secret = bot.webhookSecretRef ? await deps.loadCredential(bot.webhookSecretRef) : null;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (secret) {
        headers[secretHeaderName(bot)] = secret;
      }
      const response = await postWebhookWithRetry(bot.webhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: outbound.elicitation ? WEBHOOK_ELICITATION_TYPE : WEBHOOK_MESSAGE_TYPE,
          botId: bot.id,
          provider: "webhook",
          userId: outbound.providerUserId,
          text: buildWebhookSelectionText(outbound),
          selection: outbound.selection,
          elicitation: outbound.elicitation,
          sentAt: Date.now(),
        }),
      });
      if (!response.ok) {
        throw new Error(`Webhook outbound endpoint returned HTTP ${response.status}`);
      }
    },
    parseCallback(payload) {
      if (!isRecord(payload)) {
        return [];
      }
      const botId = typeof payload.botId === "string" ? payload.botId : "";
      const text = typeof payload.text === "string" ? payload.text : "";
      const userId = typeof payload.userId === "string" ? payload.userId : "";
      const attachments = parseWebhookAttachments(payload);
      const elicitationResponse = parseWebhookElicitationResponse(payload);
      if (!botId || (!text && attachments.length === 0 && !elicitationResponse) || !userId) {
        return [];
      }
      const inbound: BotInboundMessage = {
        botId,
        text,
        actor: {
          provider: "webhook",
          botId,
          providerUserId: userId,
          displayName: typeof payload.displayName === "string" ? payload.displayName : undefined,
          chatType: payload.chatType === "group" ? "group" : "private",
          chatId: typeof payload.chatId === "string" ? payload.chatId : undefined,
          providerMessageId:
            typeof payload.messageId === "string"
              ? payload.messageId
              : typeof payload.id === "string"
                ? payload.id
                : undefined,
        },
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(elicitationResponse ? { elicitationResponse } : {}),
      };
      return [inbound];
    },
  };
}

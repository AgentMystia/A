import type { BotConfigEntry } from "@zcode/shared";
import {
  TELEGRAM_COMMAND_DESCRIPTIONS,
  TELEGRAM_COMMAND_NAMES,
  TELEGRAM_COMMAND_ORDER,
} from "./botsPaths.js";
import type { BotSelection } from "./botsTypes.js";

const TELEGRAM_TEXT_CHUNK = 3900;

export function splitTelegramText(text: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += TELEGRAM_TEXT_CHUNK) {
    chunks.push(text.slice(index, index + TELEGRAM_TEXT_CHUNK));
  }
  return chunks.length > 0 ? chunks : [text];
}

export function truncateCallbackToast(text: string): string {
  const normalized = text.trim().replace(/\s+/gu, " ");
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

export function decodeTelegramCallbackData(data: string): string {
  if (data === "zc:cancel") {
    return "/cancel";
  }
  if (data.startsWith("zc:e:")) {
    const [, , token, option] = data.split(":");
    return token && option ? `/elicitation ${token} ${option}` : "/elicitation";
  }
  if (data.startsWith("zc:cmd:")) {
    return data.slice(7);
  }
  return data.startsWith("zc:") ? `/${data.slice(3).replace(":", " ")}` : data;
}

export function buildTelegramCommands(bot: BotConfigEntry): Array<{ command: string; description: string }> {
  return TELEGRAM_COMMAND_ORDER.filter(
    (name) => name === "help" || name === "bind" || bot.allowedCommands[name] !== false,
  ).map((name) => ({
    command: TELEGRAM_COMMAND_NAMES[name],
    description: TELEGRAM_COMMAND_DESCRIPTIONS[name],
  }));
}

function buildSelectionCallbackData(selection: BotSelection, optionId: string, index: number): string {
  if (selection.action === "permission.respond") {
    return `zc:permission:${index + 1}`;
  }
  if (selection.action === "elicitation.respond") {
    return selection.token ? `zc:e:${selection.token}:${index + 1}` : `zc:elicitation:${index + 1}`;
  }
  if (selection.action === "model.provider.set") {
    return `zc:cmd:/model provider ${index + 1}`;
  }
  if (selection.action === "model.set") {
    return `zc:cmd:/model model ${index + 1}`;
  }
  return `zc:${selection.action.replace(".set", "")}:${index + 1}`;
}

export function buildSelectionReplyMarkup(selection: BotSelection): unknown {
  const cancel =
    selection.showCancel === false
      ? []
      : [[{ text: selection.cancelLabel ?? "Cancel", callback_data: "zc:cancel" }]];
  return {
    inline_keyboard: [
      ...selection.options.map((option, index) => [
        {
          text: option.label,
          callback_data: buildSelectionCallbackData(selection, option.id, index),
        },
      ]),
      ...cancel,
    ],
  };
}

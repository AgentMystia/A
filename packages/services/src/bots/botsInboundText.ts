import type { BotActor, BotConfigEntry, BotWorkspaceRef } from "@zcode/shared";
import type { ISettingService } from "../setting/setting.js";
import { WORKSPACE_REF_CACHE_MS } from "./botsConstants.js";
import {
  formatBotMessage,
  type BotCopyKey,
  type BotMessageLocale,
} from "./botsCopy.js";
import { createWorkspaceRef, getWorkspaceKey } from "./botsNormalize.js";
import { HELP_COPY_KEYS, TELEGRAM_COMMAND_ORDER } from "./botsPaths.js";

export function copy(
  locale: string | undefined,
  key: BotCopyKey,
  vars: Record<string, unknown> = {},
): string {
  return formatBotMessage(locale, key, vars);
}

export function getActorContextKey(actor: BotActor): string {
  return [actor.botId, actor.provider, actor.chatId?.trim() || actor.providerUserId].join("::");
}

export function formatStatusLine(locale: BotMessageLocale, key: BotCopyKey, value: string): string {
  return `${copy(locale, key)}: ${value}`;
}

export function formatStatusStateValue(locale: BotMessageLocale, value: string): string {
  if (locale === "en-US") {
    return value;
  }
  switch (value) {
    case "draft":
      return copy(locale, "statusDraft");
    case "remote disconnected":
      return copy(locale, "statusRemoteDisconnected");
    case "running":
      return copy(locale, "streamingStatusRunning");
    case "completed":
      return copy(locale, "streamingStatusCompleted");
    case "error":
    case "failed":
      return copy(locale, "streamingStatusFailed");
    case "cancelled":
      return copy(locale, "statusCancelled");
    case "stopped":
      return copy(locale, "statusStopped");
    default:
      return value;
  }
}

export function buildHelpText(locale: BotMessageLocale, bot: BotConfigEntry): string {
  const lines = [copy(locale, "helpTitle")];
  for (const name of TELEGRAM_COMMAND_ORDER) {
    if (name === "help" || name === "bind") {
      lines.push(copy(locale, HELP_COPY_KEYS[name]));
      continue;
    }
    if (bot.allowedCommands[name] !== false) {
      lines.push(copy(locale, HELP_COPY_KEYS[name]));
    }
  }
  return lines.join("\n");
}

/** 发布包 host `listWorkspaceRefs`：5s 缓存 lastWorkspaceSession。 */
export function createWorkspaceRefCache(settingService: Pick<ISettingService, "get">): {
  list(currentWorkspace?: BotWorkspaceRef): Promise<BotWorkspaceRef[]>;
  clear(): void;
} {
  const cache = new Map<string, { expiresAt: number; value: BotWorkspaceRef[] }>();
  return {
    clear() {
      cache.clear();
    },
    async list(currentWorkspace) {
      const key = currentWorkspace
        ? getWorkspaceKey(currentWorkspace.workspacePath, currentWorkspace.workspaceIdentity)
        : "__default__";
      const now = Date.now();
      const hit = cache.get(key);
      if (hit && hit.expiresAt > now) {
        return hit.value;
      }
      const refs = new Map<string, BotWorkspaceRef>();
      if (currentWorkspace) {
        refs.set(getWorkspaceKey(currentWorkspace.workspacePath, currentWorkspace.workspaceIdentity), currentWorkspace);
      }
      const settings = await settingService.get().catch(() => null);
      for (const entry of settings?.lastWorkspaceSession ?? []) {
        const ref = createWorkspaceRef(
          entry.workspacePath,
          entry.kind === "remote" ? entry.workspaceIdentity : undefined,
        );
        refs.set(getWorkspaceKey(ref.workspacePath, ref.workspaceIdentity), ref);
      }
      const value = [...refs.values()];
      cache.set(key, { expiresAt: now + WORKSPACE_REF_CACHE_MS, value });
      return value;
    },
  };
}

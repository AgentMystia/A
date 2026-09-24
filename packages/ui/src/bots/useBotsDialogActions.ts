import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { BotConfigEntry, BotsConfig } from "@zcode/shared";

import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { isImeComposingKeyEvent } from "@/lib/imeComposition.js";
import { logger } from "@/logger.js";
import { toast } from "@/components/ui/toast.js";

import { TELEGRAM_BOT_FATHER_URL, allowsAllWorkspaces, botDisplayName } from "./botsDialogModel.js";
import type { BindCodeView, BotNameDraft } from "./botsDialogTypes.js";

export function useBotsDialogActions(input: {
  botsService: {
    resetBotState: (botId: string) => Promise<void>;
    removeBotSecret: (botId: string) => Promise<BotConfigEntry>;
    deleteBot: (botId: string) => Promise<void>;
  };
  selectedBot: BotConfigEntry | null;
  saveBot: (bot: BotConfigEntry, credentialValue?: string) => Promise<BotConfigEntry>;
  setConfig: Dispatch<SetStateAction<BotsConfig>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setCreating: Dispatch<SetStateAction<boolean>>;
  setCreatingProvider: Dispatch<SetStateAction<BotConfigEntry["provider"] | null>>;
  credentialDraft: string;
  setCredentialDraft: Dispatch<SetStateAction<string>>;
  secretSaving: boolean;
  setSecretSaving: Dispatch<SetStateAction<boolean>>;
  setWorkspaceSaving: Dispatch<SetStateAction<boolean>>;
  workspaceRefs: { id: string }[];
  bindCode: BindCodeView | null;
  bindExpired: boolean;
  setBindCode: Dispatch<SetStateAction<BindCodeView | null>>;
  clearRegistration: () => void;
  load: () => Promise<void>;
  nameValue: string;
  fallbackName: string;
  setNameDraft: Dispatch<SetStateAction<BotNameDraft | null>>;
  setRenamingBotId: Dispatch<SetStateAction<string | null>>;
  renamingBotId: string | null;
  composingRef: MutableRefObject<boolean>;
  registrationStarted: MutableRefObject<Set<string>>;
  bindStarted: MutableRefObject<Set<string>>;
  createBindCode: (bot: BotConfigEntry) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const confirm = useConfirmDialog();
  const { selectedBot, saveBot } = input;

  const patchAllowed = useCallback(
    async (allowed: string[]) => {
      if (!selectedBot) return;
      input.setWorkspaceSaving(true);
      const previous = selectedBot;
      const next = { ...selectedBot, allowedWorkspaces: allowed.length > 0 ? allowed : ["*"] };
      input.setConfig((current) => ({
        ...current,
        bots: current.bots.map((bot) => (bot.id === next.id ? next : bot)),
      }));
      try {
        await saveBot(next);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("[BotsDialog] 保存工作区访问范围失败", message);
        input.setConfig((current) => ({
          ...current,
          bots: current.bots.map((bot) => (bot.id === previous.id ? previous : bot)),
        }));
        toast(intl.formatMessage({ id: "bots.saveFailed" }, { error: message }));
      } finally {
        input.setWorkspaceSaving(false);
      }
    },
    [input, intl, saveBot, selectedBot],
  );

  return {
    patchAllowed,
    toggleWorkspace: (workspaceId: string, allowed: boolean) => {
      if (!selectedBot) return;
      const base = allowsAllWorkspaces(selectedBot.allowedWorkspaces)
        ? input.workspaceRefs.map((ref) => ref.id)
        : selectedBot.allowedWorkspaces;
      void patchAllowed(
        allowed ? [...new Set([...base, workspaceId])] : base.filter((id) => id !== workspaceId),
      );
    },
    saveSecret: async () => {
      if (!selectedBot || input.secretSaving) return;
      input.setSecretSaving(true);
      try {
        await saveBot(selectedBot, input.credentialDraft);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("[BotsDialog] 保存 Bot secret 失败", message);
        toast(intl.formatMessage({ id: "bots.saveFailed" }, { error: message }));
      } finally {
        input.setSecretSaving(false);
      }
    },
    copyBindCommand: async () => {
      if (!input.bindCode || input.bindExpired) return;
      const command = `/bind ${input.bindCode.code}`;
      await navigator.clipboard?.writeText(command).catch((error: unknown) => {
        logger.warn(
          "[BotsDialog] 复制绑定命令失败",
          error instanceof Error ? error.message : String(error),
        );
      });
      toast(intl.formatMessage({ id: "bots.bindCommandCopied" }));
    },
    openBotFather: () => platform.openExternal(TELEGRAM_BOT_FATHER_URL),
    unbind: async () => {
      if (!selectedBot) return;
      await saveBot({ ...selectedBot, providerUserId: undefined, displayName: undefined });
      await input.botsService.resetBotState(selectedBot.id);
    },
    removeSecret: async () => {
      if (!selectedBot) return;
      try {
        const saved = await input.botsService.removeBotSecret(selectedBot.id);
        input.registrationStarted.current.delete(`${selectedBot.id}:feishu-registration`);
        input.registrationStarted.current.delete(`${selectedBot.id}:weixin-registration`);
        input.bindStarted.current.delete(selectedBot.id);
        input.setConfig((current) => ({
          ...current,
          bots: current.bots.map((bot) => (bot.id === saved.id ? saved : bot)),
        }));
        input.setCredentialDraft("");
        input.setBindCode(null);
        await input.load();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("[BotsDialog] 移除 Bot secret 失败", message);
        toast(intl.formatMessage({ id: "bots.removeSecretFailed" }, { error: message }));
      }
    },
    deleteBot: async () => {
      if (!selectedBot) return;
      const confirmed = await confirm({
        title: intl.formatMessage(
          { id: "bots.deleteConfirmTitle" },
          { name: botDisplayName(selectedBot.name, input.fallbackName) },
        ),
        description: intl.formatMessage({ id: "bots.deleteConfirmDescription" }),
        confirmLabel: intl.formatMessage({ id: "bots.delete" }),
      });
      if (!confirmed) return;
      try {
        await input.botsService.deleteBot(selectedBot.id);
        input.setSelectedId(null);
        await input.load();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("[BotsDialog] 删除 Bot 失败", message);
        toast(intl.formatMessage({ id: "bots.deleteFailed" }, { error: message }));
      }
    },
    startCreate: () => {
      input.setCreating(true);
      input.setCreatingProvider(null);
      input.setSelectedId(null);
      input.setCredentialDraft("");
      input.setBindCode(null);
      input.clearRegistration();
    },
    selectBot: (botId: string) => {
      input.setCreating(false);
      input.setSelectedId(botId);
    },
    patchBot: (patch: Partial<BotConfigEntry>) => {
      if (selectedBot) void saveBot({ ...selectedBot, ...patch });
    },
    startRename: () => {
      if (!selectedBot) return;
      input.setRenamingBotId(selectedBot.id);
      input.setNameDraft({ botId: selectedBot.id, value: selectedBot.name });
    },
    commitName: () => {
      if (!selectedBot) return;
      const next = input.nameValue.trim();
      input.setNameDraft(null);
      input.setRenamingBotId(null);
      if (next !== selectedBot.name) void saveBot({ ...selectedBot, name: next });
    },
    changeName: (value: string) => {
      if (selectedBot) input.setNameDraft({ botId: selectedBot.id, value });
    },
    compositionStart: () => {
      input.composingRef.current = true;
    },
    compositionEnd: () => {
      input.composingRef.current = false;
    },
    nameKeyDown: (event: {
      key: string;
      nativeEvent: KeyboardEvent;
      currentTarget: HTMLInputElement;
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => {
      if (event.key === "Enter") {
        if (
          isImeComposingKeyEvent({
            compositionActive: input.composingRef.current,
            nativeEvent: event.nativeEvent,
          })
        ) {
          logger.debug("[BotsDialog] ignore bot name enter during IME", {
            botId: selectedBot?.id ?? null,
          });
          return;
        }
        event.currentTarget.blur();
        return;
      }
      if (event.key === "Escape") {
        input.setNameDraft(null);
        input.setRenamingBotId(null);
        event.preventDefault();
        event.stopPropagation();
      }
    },
    preventCloseWhileRenaming: (event: { preventDefault: () => void }) => {
      if (input.renamingBotId === null) return;
      event.preventDefault();
      input.setNameDraft(null);
      input.setRenamingBotId(null);
    },
    createBindCode: () => {
      if (selectedBot) void input.createBindCode(selectedBot);
    },
  };
}

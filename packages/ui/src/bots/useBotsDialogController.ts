import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isFeishuBotProvider,
  type BotConfigEntry,
  type BotProviderId,
  type BotWorkspaceRef,
} from "@zcode/shared";

import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { toast } from "@/components/ui/toast.js";

import {
  bindCodeRequest,
  botDisplayName,
  botWorkspaceKey,
  createBotDraft,
  selectOrCreateBot,
} from "./botsDialogModel.js";
import { useBotsDialogActions } from "./useBotsDialogActions.js";
import type { BotNameDraft } from "./botsDialogTypes.js";
import { useBotsDialogData } from "./useBotsDialogData.js";
import { useBotsRegistration } from "./useBotsRegistration.js";

export function useBotsDialogController({
  open,
  workspacePath,
  workspaceIdentity,
  entryProvider,
}: {
  open: boolean;
  workspacePath: string;
  workspaceIdentity?: string;
  entryProvider?: BotProviderId | null;
}) {
  const { intl } = useZCodeIntl();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingProvider, setCreatingProvider] = useState<BotProviderId | null>(null);
  const [credentialDraft, setCredentialDraft] = useState("");
  const [secretSaving, setSecretSaving] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [nameDraft, setNameDraft] = useState<BotNameDraft | null>(null);
  const [renamingBotId, setRenamingBotId] = useState<string | null>(null);
  const composingRef = useRef(false);
  const registrationStarted = useRef(new Set<string>());
  const bindStarted = useRef(new Set<string>());
  const entryHandled = useRef<string | null>(null);
  const workspaceKey = botWorkspaceKey(workspacePath, workspaceIdentity);
  const currentWorkspace = useMemo<BotWorkspaceRef>(
    () => ({
      id: workspaceKey,
      label: workspacePath.split(/[\\/]/u).filter(Boolean).at(-1) ?? workspacePath,
      workspacePath,
      workspaceIdentity,
    }),
    [workspaceIdentity, workspaceKey, workspacePath],
  );
  const {
    botsService,
    config,
    setConfig,
    workspaceRefs,
    status,
    botStates,
    setBotStates,
    loaded,
    bindCode,
    setBindCode,
    setNow,
    remainingMs,
    bindExpired,
    bindProgress,
    load,
  } = useBotsDialogData({
    open,
    currentWorkspace,
    creating,
    setSelectedId,
  });
  const selectedBot = config.bots.find((bot) => bot.id === selectedId) ?? null;
  const runtime = selectedBot
    ? status?.botRuntime.find((item) => item.botId === selectedBot.id)
    : undefined;
  const runtimeState = botStates.find((item) => item.botId === selectedId);
  const fallbackName = intl.formatMessage({ id: "bots.newBot.fallbackName" });
  const nameValue =
    selectedBot && nameDraft?.botId === selectedBot.id
      ? nameDraft.value
      : (selectedBot?.name ?? "");

  const saveBot = useCallback(
    async (bot: BotConfigEntry, credentialValue?: string) => {
      const saved = await botsService.saveBot({ bot, credentialValue });
      setConfig((current) => ({
        ...current,
        bots: [...current.bots.filter((item) => item.id !== saved.id), saved],
      }));
      setSelectedId(saved.id);
      setCreating(false);
      setCredentialDraft("");
      await load();
      return saved;
    },
    [botsService, load, setConfig],
  );
  const registration = useBotsRegistration({ open, bot: selectedBot, saveBot });
  const {
    feishuRegistration,
    feishuLoading,
    weixinRegistration,
    weixinLoading,
    startFeishu,
    startWeixin,
    clearRegistration,
  } = registration;

  useEffect(() => {
    setCredentialDraft("");
    setSecretSaving(false);
    setWorkspaceSaving(false);
  }, [selectedBot?.id, selectedBot?.provider]);

  useEffect(() => {
    if (!bindCode || bindCode.botId !== selectedBot?.id || !selectedBot.providerUserId) return;
    setBindCode(null);
  }, [bindCode, selectedBot?.id, selectedBot?.providerUserId, setBindCode]);

  useEffect(() => {
    if (
      !open ||
      selectedBot?.provider !== "weixin" ||
      !selectedBot.credentialRef ||
      runtimeState?.weixinActivatedAt
    ) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await botsService.getBotStates();
        if (!cancelled) setBotStates(next);
      } catch (error) {
        logger.warn(
          "[BotsDialog] 轮询微信 Bot 激活状态失败",
          error instanceof Error ? error.message : String(error),
        );
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    botsService,
    open,
    runtimeState?.weixinActivatedAt,
    selectedBot?.credentialRef,
    selectedBot?.id,
    selectedBot?.provider,
    setBotStates,
  ]);

  const createBindCode = useCallback(
    async (bot: BotConfigEntry) => {
      const startedAt = Date.now();
      const result = await botsService.createBindCode(bindCodeRequest(bot));
      setNow(startedAt);
      setBindCode({
        botId: bot.id,
        code: result.code,
        createdAt: startedAt,
        expiresAt: result.expiresAt,
        ttlMs: Math.max(1, result.expiresAt - startedAt),
      });
    },
    [botsService, setBindCode, setNow],
  );

  const createBot = useCallback(
    async (provider: BotProviderId) => {
      if (creatingProvider) return;
      setCreatingProvider(provider);
      try {
        const draft = createBotDraft(provider);
        await saveBot({
          ...draft,
          name: "",
          ...(provider === "webhook" ? { webhookAuthHeaderName: "x-zcode-bot-secret" } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("[BotsDialog] 创建 Bot 失败", message);
        toast(intl.formatMessage({ id: "bots.saveFailed" }, { error: message }));
      } finally {
        setCreatingProvider(null);
      }
    },
    [creatingProvider, intl, saveBot],
  );

  useEffect(() => {
    entryHandled.current = null;
  }, [entryProvider, open]);

  useEffect(() => {
    if (!open || !entryProvider || !loaded || entryHandled.current === entryProvider) return;
    const decision = selectOrCreateBot(config.bots, entryProvider);
    entryHandled.current = entryProvider;
    setCredentialDraft("");
    clearRegistration();
    setBindCode(null);
    if (decision.mode === "select") {
      setCreating(false);
      setCreatingProvider(null);
      setSelectedId(decision.botId);
      return;
    }
    setCreating(true);
    setSelectedId(null);
    void createBot(decision.provider);
  }, [clearRegistration, config.bots, createBot, entryProvider, loaded, open, setBindCode]);

  useEffect(() => {
    if (!open || creating || !selectedBot) return;
    if (isFeishuBotProvider(selectedBot.provider)) {
      if (!selectedBot.credentialRef) {
        if (feishuLoading || feishuRegistration?.botId === selectedBot.id) return;
        const key = `${selectedBot.id}:feishu-registration`;
        if (registrationStarted.current.has(key)) return;
        registrationStarted.current.add(key);
        void startFeishu();
        return;
      }
      if (!selectedBot.providerUserId) {
        if (
          (bindCode?.botId === selectedBot.id && !bindExpired) ||
          bindStarted.current.has(selectedBot.id)
        ) {
          return;
        }
        bindStarted.current.add(selectedBot.id);
        void createBindCode(selectedBot).finally(() => bindStarted.current.delete(selectedBot.id));
      }
      return;
    }
    if (selectedBot.provider === "telegram") {
      if (
        !selectedBot.credentialRef ||
        selectedBot.providerUserId ||
        (bindCode?.botId === selectedBot.id && !bindExpired) ||
        bindStarted.current.has(selectedBot.id)
      ) {
        return;
      }
      bindStarted.current.add(selectedBot.id);
      void createBindCode(selectedBot).finally(() => bindStarted.current.delete(selectedBot.id));
      return;
    }
    if (
      selectedBot.provider !== "weixin" ||
      selectedBot.credentialRef ||
      weixinLoading ||
      weixinRegistration?.botId === selectedBot.id
    ) {
      return;
    }
    const key = `${selectedBot.id}:weixin-registration`;
    if (registrationStarted.current.has(key)) return;
    registrationStarted.current.add(key);
    void startWeixin();
  }, [
    bindCode,
    bindExpired,
    createBindCode,
    creating,
    feishuLoading,
    feishuRegistration,
    open,
    selectedBot,
    startFeishu,
    startWeixin,
    weixinLoading,
    weixinRegistration,
  ]);

  const actions = useBotsDialogActions({
    botsService,
    selectedBot,
    saveBot,
    setConfig,
    setSelectedId,
    setCreating,
    setCreatingProvider,
    credentialDraft,
    setCredentialDraft,
    secretSaving,
    setSecretSaving,
    setWorkspaceSaving,
    workspaceRefs,
    bindCode,
    bindExpired,
    setBindCode,
    clearRegistration,
    load,
    nameValue,
    fallbackName,
    setNameDraft,
    setRenamingBotId,
    renamingBotId,
    composingRef,
    registrationStarted,
    bindStarted,
    createBindCode,
  });

  return {
    runtimeFor: (botId: string) => status?.botRuntime.find((item) => item.botId === botId),
    config,
    workspaceRefs,
    currentWorkspace,
    selectedBot,
    runtime,
    creating,
    creatingProvider,
    credentialDraft,
    secretSaving,
    workspaceSaving,
    bindCode,
    bindExpired,
    bindRemainingMs: remainingMs,
    bindCountdownProgress: bindProgress,
    feishuRegistration,
    feishuRegistrationLoading: feishuLoading,
    weixinRegistration,
    weixinRegistrationLoading: weixinLoading,
    weixinActivated: Boolean(runtimeState?.weixinActivatedAt),
    renaming: renamingBotId === selectedBot?.id,
    nameValue,
    displayName: botDisplayName(nameValue, fallbackName),
    fallbackName,
    createBot,
    setCredentialDraft,
    startFeishu: () => void startFeishu(),
    startWeixin: () => void startWeixin(),
    ...actions,
  };
}

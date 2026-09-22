import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  createDefaultBotsConfig,
  type BotRuntimeState,
  type BotWorkspaceRef,
  type BotsConfig,
  type BotsServiceStatus,
} from "@zcode/shared";

import { useBotsService } from "@/hooks/useBotsService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { toast } from "@/components/ui/toast.js";

import type { BindCodeView } from "./botsDialogTypes.js";

export function useBotsDialogData({
  open,
  currentWorkspace,
  creating,
  setSelectedId,
}: {
  open: boolean;
  currentWorkspace: BotWorkspaceRef;
  creating: boolean;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
}) {
  const botsService = useBotsService();
  const { intl } = useZCodeIntl();
  const [config, setConfig] = useState<BotsConfig>(() => createDefaultBotsConfig());
  const [workspaceRefs, setWorkspaceRefs] = useState<BotWorkspaceRef[]>([]);
  const [status, setStatus] = useState<BotsServiceStatus | null>(null);
  const [botStates, setBotStates] = useState<BotRuntimeState[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [bindCode, setBindCode] = useState<BindCodeView | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const [nextConfig, nextStatus, nextRefs, nextStates] = await Promise.all([
        botsService.getConfig(),
        botsService.getStatus(),
        botsService.listWorkspaceRefs(currentWorkspace),
        botsService.getBotStates(),
      ]);
      setConfig(nextConfig);
      setStatus(nextStatus);
      setWorkspaceRefs(nextRefs);
      setBotStates(nextStates);
      setLoaded(true);
      setSelectedId((current) =>
        creating ? current : (current ?? nextConfig.bots[0]?.id ?? null),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("[BotsDialog] 加载 Bots 配置失败", message);
      toast(intl.formatMessage({ id: "bots.loadFailed" }, { error: message }));
    }
  }, [botsService, creating, currentWorkspace, intl, setSelectedId]);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    void load();
  }, [load, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await botsService.getStatus();
        if (!cancelled) setStatus(next);
      } catch (error) {
        logger.debug("[BotsDialog] 刷新 Bot 运行状态失败", error);
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void poll(), 2000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [botsService, open]);

  useEffect(() => {
    if (!open || !bindCode) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [bindCode, open]);

  const remainingMs = bindCode ? Math.max(0, bindCode.expiresAt - now) : 0;
  const bindExpired = Boolean(bindCode && remainingMs <= 0);

  useEffect(() => {
    if (!open || !bindCode || bindExpired) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await botsService.getConfig();
        if (cancelled) return;
        setConfig(next);
        if (next.bots.find((bot) => bot.id === bindCode.botId)?.providerUserId) setBindCode(null);
      } catch (error) {
        logger.warn(
          "[BotsDialog] 轮询 Bot 绑定结果失败",
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
  }, [bindCode, bindExpired, botsService, open]);

  return {
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
    bindProgress: bindCode ? Math.max(0, Math.min(100, (remainingMs / bindCode.ttlMs) * 100)) : 0,
    load,
  };
}

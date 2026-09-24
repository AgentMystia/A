import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  isFeishuBotProvider,
  type BotConfigEntry,
  type FeishuRegistrationPoll,
} from "@zcode/shared";

import { useBotsService } from "@/hooks/useBotsService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { toast } from "@/components/ui/toast.js";

import type { FeishuRegistrationView, WeixinRegistrationView } from "./botsDialogTypes.js";

function feishuDomain(value: string | undefined, fallback: "feishu" | "lark"): "feishu" | "lark" {
  return value === "feishu" || value === "lark" ? value : fallback;
}

export function useBotsRegistration({
  open,
  bot,
  saveBot,
}: {
  open: boolean;
  bot: BotConfigEntry | null;
  saveBot: (bot: BotConfigEntry, credentialValue?: string) => Promise<BotConfigEntry>;
}) {
  const botsService = useBotsService();
  const { intl } = useZCodeIntl();
  const [feishuRegistration, setFeishuRegistration] = useState<FeishuRegistrationView | null>(null);
  const [feishuLoading, setFeishuLoading] = useState(false);
  const [weixinRegistration, setWeixinRegistration] = useState<WeixinRegistrationView | null>(null);
  const [weixinLoading, setWeixinLoading] = useState(false);

  useEffect(() => {
    setFeishuRegistration(null);
    setWeixinRegistration(null);
  }, [bot?.id, bot?.provider]);

  const startFeishu = useCallback(async () => {
    if (!bot || (bot.provider !== "feishu" && bot.provider !== "lark")) return;
    setFeishuLoading(true);
    try {
      const started = await botsService.beginFeishuRegistration({ domain: bot.provider });
      let qrDataUrl: string | null = null;
      try {
        qrDataUrl = await QRCode.toDataURL(started.qrUrl, { margin: 1, width: 220 });
      } catch (error) {
        logger.error(
          "[BotsDialog] 生成飞书注册二维码失败",
          error instanceof Error ? error.message : String(error),
        );
      }
      setFeishuRegistration({
        botId: bot.id,
        deviceCode: started.deviceCode,
        qrUrl: started.qrUrl,
        qrDataUrl,
        userCode: started.userCode,
        interval: started.interval,
        expiresAt: started.expiresAt,
        domain: started.domain,
        pollDomain: started.pollDomain,
        status: "pending",
      });
      toast(intl.formatMessage({ id: "bots.feishuRegistrationStarted" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("[BotsDialog] 启动飞书扫码注册失败", message);
      toast(intl.formatMessage({ id: "bots.feishuRegistrationFailed" }, { error: message }));
    } finally {
      setFeishuLoading(false);
    }
  }, [bot, botsService, intl]);

  const startWeixin = useCallback(async () => {
    if (!bot || bot.provider !== "weixin") return;
    setWeixinLoading(true);
    try {
      const started = await botsService.beginWeixinRegistration();
      let qrDataUrl: string | null = null;
      try {
        qrDataUrl = await QRCode.toDataURL(started.qrUrl, { margin: 1, width: 220 });
      } catch (error) {
        logger.error(
          "[BotsDialog] 生成微信登录二维码失败",
          error instanceof Error ? error.message : String(error),
        );
      }
      setWeixinRegistration({
        botId: bot.id,
        qrCode: started.qrCode,
        qrUrl: started.qrUrl,
        qrDataUrl,
        interval: started.interval,
        expiresAt: started.expiresAt,
        status: "pending",
      });
      toast(intl.formatMessage({ id: "bots.weixinRegistrationStarted" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("[BotsDialog] 启动微信扫码登录失败", message);
      toast(intl.formatMessage({ id: "bots.weixinRegistrationFailed" }, { error: message }));
    } finally {
      setWeixinLoading(false);
    }
  }, [bot, botsService, intl]);

  useEffect(() => {
    const current = feishuRegistration;
    if (
      !open ||
      !bot ||
      !isFeishuBotProvider(bot.provider) ||
      !current ||
      current.status !== "pending"
    ) {
      return;
    }
    let cancelled = false;
    const intervalMs = Math.max(1, current.interval) * 1000;
    const poll = async () => {
      try {
        const next = await botsService.pollFeishuRegistration({
          deviceCode: current.deviceCode,
          domain: current.domain,
          pollDomain: current.pollDomain,
        });
        if (cancelled) return;
        if (next.status === "pending") {
          setFeishuRegistration((existing) =>
            !existing ||
            existing.deviceCode !== current.deviceCode ||
            (existing.interval === next.interval &&
              existing.domain === next.domain &&
              existing.pollDomain === next.pollDomain)
              ? existing
              : {
                  ...existing,
                  interval: next.interval,
                  domain: feishuDomain(next.domain, existing.domain),
                  pollDomain: next.pollDomain ?? existing.pollDomain,
                },
          );
          return;
        }
        if (next.status === "success") {
          const saved = await saveBot(
            {
              ...bot,
              provider: bot.provider,
              name: next.appName?.trim() || bot.name,
              feishuAppId: next.appId,
            },
            next.appSecret,
          );
          if (!cancelled) {
            setFeishuRegistration(null);
            toast(intl.formatMessage({ id: "bots.feishuRegistrationSuccess" }));
          }
          return saved;
        }
        setFeishuRegistration((existing) =>
          existing?.deviceCode === current.deviceCode
            ? {
                ...existing,
                status: next.status,
                message: registrationMessage(next, intl.formatMessage),
              }
            : existing,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("[BotsDialog] 飞书扫码注册轮询失败", message);
        if (!cancelled) {
          setFeishuRegistration((existing) =>
            existing?.deviceCode === current.deviceCode
              ? { ...existing, status: "error", message }
              : existing,
          );
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [bot, botsService, feishuRegistration, intl, open, saveBot]);

  useEffect(() => {
    const current = weixinRegistration;
    if (
      !open ||
      !bot ||
      bot.provider !== "weixin" ||
      !current ||
      (current.status !== "pending" && current.status !== "scanned")
    ) {
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const delay = Math.max(1, current.interval) * 1000;
    const schedule = () => {
      if (!cancelled) timer = window.setTimeout(() => void run(), delay);
    };
    const run = async () => {
      try {
        const next = await botsService.pollWeixinRegistration({ qrCode: current.qrCode });
        if (cancelled) return;
        if (next.status === "pending" || next.status === "scanned") {
          setWeixinRegistration((existing) =>
            !existing ||
            existing.qrCode !== current.qrCode ||
            (existing.interval === (next.interval ?? existing.interval) &&
              existing.status === next.status)
              ? existing
              : {
                  ...existing,
                  interval: next.interval ?? existing.interval,
                  status: next.status,
                },
          );
          schedule();
          return;
        }
        if (next.status === "success") {
          await saveBot(
            {
              ...bot,
              webhookUrl: undefined,
              providerUserId: next.botId ?? bot.providerUserId,
              displayName: next.botId ?? bot.displayName,
              name: bot.name,
            },
            next.botToken,
          );
          if (!cancelled) {
            setWeixinRegistration(null);
            toast(intl.formatMessage({ id: "bots.weixinRegistrationSuccess" }));
          }
          return;
        }
        const message = "message" in next ? next.message : undefined;
        setWeixinRegistration((existing) =>
          existing?.qrCode === current.qrCode
            ? {
                ...existing,
                status: next.status,
                message:
                  message ?? intl.formatMessage({ id: `bots.weixinRegistration.${next.status}` }),
              }
            : existing,
        );
      } catch (error) {
        logger.error(
          "[BotsDialog] 微信扫码登录轮询失败",
          error instanceof Error ? error.message : String(error),
        );
        schedule();
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [bot, botsService, intl, open, saveBot, weixinRegistration]);

  const clearRegistration = useCallback(() => {
    setFeishuRegistration(null);
    setWeixinRegistration(null);
  }, []);

  return {
    feishuRegistration,
    feishuLoading,
    weixinRegistration,
    weixinLoading,
    startFeishu,
    startWeixin,
    clearRegistration,
  };
}

function registrationMessage(
  next: Exclude<FeishuRegistrationPoll, { status: "pending" | "success" }>,
  formatMessage: (descriptor: { id: string }) => string,
): string {
  return "message" in next && next.message
    ? next.message
    : formatMessage({ id: `bots.feishuRegistration.${next.status}` });
}

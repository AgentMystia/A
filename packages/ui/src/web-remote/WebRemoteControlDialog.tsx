import { useEffect, useState } from "react";
import QRCode from "qrcode";

import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import type { BotProviderId, WebRemoteControlStatus } from "@zcode/shared";

import { BotsDialog } from "@/bots/BotsDialog.js";
import { WebRemoteControlDialogView } from "./WebRemoteControlDialogView.js";
import {
  sameWebRemoteControlDialogStatus,
  webRemoteControlDeviceLabel,
  webRemoteControlFailureLabel,
  webRemoteControlHasConnectedPhone,
  webRemoteControlPhaseDotClass,
  webRemoteControlSessionMatchesWorkspace,
  webRemoteControlStatusDetail,
  webRemoteControlStatusLabel,
} from "./webRemoteControlFormat.js";

export function WebRemoteControlDialog({
  open,
  onOpenChange,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  initialTaskId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
}) {
  const platform = usePlatform();
  const confirm = useConfirmDialog();
  const { intl } = useZCodeIntl();
  const [status, setStatus] = useState<WebRemoteControlStatus>({ status: "idle" });
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [botsOpen, setBotsOpen] = useState(false);
  const [entryProvider, setEntryProvider] = useState<BotProviderId | null>(null);
  const statusLabel = webRemoteControlStatusLabel(status, intl.formatMessage);
  const statusDetail = webRemoteControlStatusDetail(status, intl.formatMessage);
  const failureLabel = webRemoteControlFailureLabel(status.failure, intl.formatMessage);
  const deviceLabel = webRemoteControlDeviceLabel(status, intl.formatMessage);
  const phaseDotClass = webRemoteControlPhaseDotClass(status);

  useEffect(() => {
    if (!open || !platform.getWebRemoteControlStatus || !platform.startWebRemoteControl) return;
    let cancelled = false;
    void (async () => {
      setBusy(true);
      try {
        const current = await platform.getWebRemoteControlStatus!();
        let next = current;
        if (
          !webRemoteControlSessionMatchesWorkspace(
            current,
            workspacePath,
            workspaceIdentity,
            remoteSessionId,
          ) &&
          !webRemoteControlHasConnectedPhone(current)
        ) {
          const started = await platform.startWebRemoteControl!({
            workspacePath,
            workspaceIdentity,
            remoteSessionId,
            initialTaskId,
          });
          next = started.status === "cancelled" ? { status: "idle" } : started;
        }
        if (cancelled) return;
        setStatus(next);
        logger.info("[WebRemoteControlDialog] Web 远程控制状态已同步", {
          workspacePath,
          workspaceIdentity: workspaceIdentity ?? "none",
          remoteSessionId: remoteSessionId ?? "none",
          initialTaskId: initialTaskId ?? "none",
          status: next.status,
          sessionId: next.sessionId ?? "none",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled) {
          setStatus({ status: "error", workspacePath, remoteSessionId, error: message });
          toast(intl.formatMessage({ id: "webRemoteControl.startFailed" }, { error: message }));
        }
        logger.error("[WebRemoteControlDialog] 启动 Web 远程控制失败", {
          workspacePath,
          workspaceIdentity: workspaceIdentity ?? "none",
          remoteSessionId: remoteSessionId ?? "none",
          initialTaskId: initialTaskId ?? "none",
          error: message,
        });
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialTaskId, intl, open, platform, remoteSessionId, workspaceIdentity, workspacePath]);

  useEffect(() => {
    if (!open || !platform.getWebRemoteControlStatus) return;
    let cancelled = false;
    const sync = async () => {
      try {
        const next = await platform.getWebRemoteControlStatus!();
        if (cancelled) return;
        if (
          !(
            webRemoteControlSessionMatchesWorkspace(
              next,
              workspacePath,
              workspaceIdentity,
              remoteSessionId,
            ) ||
            webRemoteControlHasConnectedPhone(next) ||
            next.status === "idle" ||
            next.status === "error"
          )
        ) {
          return;
        }
        setStatus((current) => (sameWebRemoteControlDialogStatus(current, next) ? current : next));
      } catch {
        // 轮询失败保留上一次已展示的状态。
      }
    };
    const timer = window.setInterval(() => {
      void sync();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, platform, remoteSessionId, workspaceIdentity, workspacePath]);

  useEffect(() => {
    if (!status.qrUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    setQrDataUrl(null);
    void QRCode.toDataURL(status.qrUrl, { margin: 1, width: 320 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch((error: unknown) => {
        logger.error(
          "[WebRemoteControlDialog] 生成二维码失败",
          error instanceof Error ? error.message : String(error),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [status.qrUrl]);

  const copyLink = async () => {
    if (!status.connectUrl) return;
    try {
      await navigator.clipboard.writeText(status.connectUrl);
      toast(intl.formatMessage({ id: "webRemoteControl.copyLink.copied" }));
      logger.info("[WebRemoteControlDialog] 已复制 Web 远程控制链接", {
        workspacePath,
        remoteSessionId: remoteSessionId ?? "none",
        sessionId: status.sessionId ?? "none",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast(intl.formatMessage({ id: "webRemoteControl.copyLinkFailed" }, { error: message }));
      logger.error("[WebRemoteControlDialog] 复制 Web 远程控制链接失败", message);
    }
  };

  const refreshQr = async () => {
    if (!platform.refreshWebRemoteControlPairing) return;
    const confirmed = await confirm({
      title: intl.formatMessage({ id: "webRemoteControl.refreshQr.confirmTitle" }),
      description: intl.formatMessage({ id: "webRemoteControl.refreshQr.confirmDescription" }),
      confirmLabel: intl.formatMessage({ id: "webRemoteControl.refreshQr" }),
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const next = await platform.refreshWebRemoteControlPairing({
        workspacePath,
        workspaceIdentity,
        remoteSessionId,
        initialTaskId,
      });
      if (next.status === "cancelled") return;
      setStatus(next);
      toast(intl.formatMessage({ id: "webRemoteControl.refreshQr.success" }));
      logger.info("[WebRemoteControlDialog] 已刷新 Web 远程控制二维码", {
        workspacePath,
        workspaceIdentity: workspaceIdentity ?? "none",
        remoteSessionId: remoteSessionId ?? "none",
        initialTaskId: initialTaskId ?? "none",
        sessionId: next.sessionId ?? "none",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast(intl.formatMessage({ id: "webRemoteControl.refreshQr.failed" }, { error: message }));
      logger.error("[WebRemoteControlDialog] 刷新 Web 远程控制二维码失败", {
        workspacePath,
        error: message,
      });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!platform.stopWebRemoteControl) return;
    setBusy(true);
    try {
      await platform.stopWebRemoteControl();
      setStatus({ status: "idle" });
      onOpenChange(false);
      toast(intl.formatMessage({ id: "webRemoteControl.stopSuccess" }));
      logger.info("[WebRemoteControlDialog] 已关闭 Web 远程控制", {
        workspacePath,
        remoteSessionId: remoteSessionId ?? "none",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast(intl.formatMessage({ id: "webRemoteControl.stopFailed" }, { error: message }));
      logger.error("[WebRemoteControlDialog] 关闭 Web 远程控制失败", message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <WebRemoteControlDialogView
        open={open}
        workspacePath={workspacePath}
        workspaceIdentity={workspaceIdentity}
        remoteSessionId={remoteSessionId}
        status={status}
        busy={busy}
        qrDataUrl={qrDataUrl}
        statusLabel={statusLabel}
        statusDetail={statusDetail}
        failureLabel={failureLabel}
        deviceLabel={deviceLabel}
        phaseDotClass={phaseDotClass}
        onOpenChange={onOpenChange}
        onStop={() => void stop()}
        onRefresh={() => void refreshQr()}
        onCopy={() => void copyLink()}
        onOpenChannel={(provider) => {
          setEntryProvider(provider);
          setBotsOpen(true);
        }}
        onOpenBots={() => {
          setEntryProvider(null);
          setBotsOpen(true);
        }}
      />
      <BotsDialog
        open={botsOpen}
        onOpenChange={setBotsOpen}
        workspacePath={workspacePath}
        workspaceIdentity={workspaceIdentity}
        entryProvider={entryProvider}
      />
    </>
  );
}

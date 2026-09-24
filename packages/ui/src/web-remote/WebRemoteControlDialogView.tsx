import { Copy, Loader2, RefreshCw, Smartphone, Square, X } from "lucide-react";
import type { BotProviderId, WebRemoteControlStatus } from "@zcode/shared";

import { BotProviderIcon } from "@/bots/BotProviderIcon.js";
import { botChannelRegionTag, WEB_REMOTE_BOT_CHANNELS } from "@/bots/botsDialogModel.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

export function WebRemoteControlDialogView({
  open,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  status,
  busy,
  qrDataUrl,
  statusLabel,
  statusDetail,
  failureLabel,
  deviceLabel,
  phaseDotClass,
  onOpenChange,
  onStop,
  onRefresh,
  onCopy,
  onOpenChannel,
  onOpenBots,
}: {
  open: boolean;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  status: WebRemoteControlStatus;
  busy: boolean;
  qrDataUrl: string | null;
  statusLabel: string;
  statusDetail: string;
  failureLabel: string | null;
  deviceLabel: string;
  phaseDotClass: string;
  onOpenChange: (open: boolean) => void;
  onStop: () => void;
  onRefresh: () => void;
  onCopy: () => void;
  onOpenChannel: (provider: BotProviderId) => void;
  onOpenBots: () => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        logger.info("[WebRemoteControlDialog] 弹层开关状态变化", {
          workspacePath,
          remoteSessionId: remoteSessionId ?? "none",
          nextOpen: next,
        });
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100vh-6rem)] max-w-4xl gap-0 overflow-hidden rounded-2xl p-0"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2 enabled:cursor-pointer [app-region:no-drag]"
          onClick={() => {
            logger.info("[WebRemoteControlDialog] 用户点击右上角关闭按钮", {
              workspacePath,
              remoteSessionId: remoteSessionId ?? "none",
              sessionId: status.sessionId ?? "none",
              status: status.status,
            });
            onOpenChange(false);
          }}
        >
          <X />
          <span className="sr-only">Close</span>
        </Button>
        <div
          data-testid="web-remote-control-dialog-scroll"
          className="max-h-[calc(100vh-6rem)] min-h-0 overflow-y-auto p-5"
        >
          <DialogHeader className="space-y-2 pr-8">
            <div className="flex items-center gap-2">
              <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface text-primary">
                <Smartphone className="size-5" />
              </div>
              <div className="space-y-1">
                <DialogTitle>{intl.formatMessage({ id: "webRemoteControl.title" })}</DialogTitle>
                <DialogDescription>
                  {intl.formatMessage({ id: "webRemoteControl.description" })}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div
            data-testid="web-remote-control-main-grid"
            className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1.45fr)_minmax(300px,1fr)]"
          >
            <section
              data-testid="web-remote-control-scan-card"
              className="flex min-h-[360px] flex-col rounded-xl border border-border bg-card p-4"
            >
              <div className="mb-4 flex items-start gap-2">
                <Smartphone className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
                <div className="min-w-0 space-y-1">
                  <div className="text-ui-base font-medium text-foreground">
                    {intl.formatMessage({ id: "webRemoteControl.mobileQr.title" })}
                  </div>
                  <p className="text-ui-base/relaxed text-foreground-subtle">
                    {intl.formatMessage({ id: "webRemoteControl.mobileQr.description" })}
                  </p>
                </div>
              </div>
              <div
                data-testid="web-remote-control-connection-card"
                className="mb-3 rounded-lg bg-surface px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="text-ui-base font-medium text-foreground">{statusLabel}</div>
                      <div className="flex min-w-0 items-center gap-1.5 rounded-full bg-card px-2 py-0.5 text-ui-xs font-medium text-foreground-subtle">
                        <span className={`size-1.5 shrink-0 rounded-full ${phaseDotClass}`} />
                        <span className="truncate">{deviceLabel}</span>
                      </div>
                    </div>
                    <div className="text-ui-base/relaxed text-foreground-subtle">
                      {statusDetail}
                    </div>
                  </div>
                  {busy ? (
                    <Loader2 className="size-4 animate-spin text-foreground-subtle" />
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      className="shrink-0 gap-2 enabled:cursor-pointer"
                      onClick={onStop}
                      disabled={status.status === "idle"}
                    >
                      <Square className="size-3.5" />
                      {intl.formatMessage({ id: "webRemoteControl.stop" })}
                    </Button>
                  )}
                </div>
                {failureLabel ? (
                  <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-ui-base/relaxed text-destructive">
                    <p>{failureLabel}</p>
                    {status.failure?.message && status.failure.message !== failureLabel ? (
                      <p className="mt-1 text-ui-xs/relaxed opacity-80">{status.failure.message}</p>
                    ) : null}
                  </div>
                ) : status.error ? (
                  <p className="mt-3 text-ui-base/relaxed text-destructive">{status.error}</p>
                ) : null}
                <div
                  data-testid="web-remote-control-copy-link-row"
                  className="mt-3 flex min-h-10 flex-wrap items-center gap-3 border-t border-border pt-3"
                >
                  <div className="min-w-48 flex-1 text-ui-base/relaxed text-foreground-subtle">
                    {intl.formatMessage({ id: "webRemoteControl.copyLink.description" })}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    className="shrink-0 gap-2 enabled:cursor-pointer"
                    onClick={onRefresh}
                    disabled={busy}
                  >
                    <RefreshCw className="size-3.5" />
                    {intl.formatMessage({ id: "webRemoteControl.refreshQr" })}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    className="shrink-0 gap-2 enabled:cursor-pointer"
                    onClick={onCopy}
                    disabled={!status.connectUrl || busy}
                  >
                    <Copy className="size-3.5" />
                    {intl.formatMessage({ id: "webRemoteControl.copyLink" })}
                  </Button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-background-alt p-4">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={intl.formatMessage({ id: "webRemoteControl.qrAlt" })}
                    className="size-64 max-w-full rounded-lg bg-white p-3"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 text-center text-ui-base text-foreground-subtle">
                    <Loader2 className="size-5 animate-spin" />
                    <span>{intl.formatMessage({ id: "webRemoteControl.generating" })}</span>
                  </div>
                )}
              </div>
            </section>
            <section className="flex min-h-[360px] flex-col rounded-xl border border-border bg-card p-4">
              <div className="mb-4 flex items-start gap-2">
                <Smartphone className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
                <div className="min-w-0 space-y-1">
                  <div className="text-ui-base font-medium text-foreground">
                    {intl.formatMessage({ id: "webRemoteControl.botChannel.title" })}
                  </div>
                  <p className="text-ui-base/relaxed text-foreground-subtle">
                    {intl.formatMessage({ id: "webRemoteControl.botChannel.description" })}
                  </p>
                </div>
              </div>
              <div className="grid min-h-0 flex-1 gap-3">
                {WEB_REMOTE_BOT_CHANNELS.map((channel) => {
                  const regionTag = botChannelRegionTag(channel.provider);
                  return (
                    <button
                      key={channel.provider}
                      type="button"
                      className="flex min-h-0 cursor-pointer items-start gap-3 rounded-lg border border-transparent bg-surface px-3 py-3 text-left transition-colors hover:border-input-border-focused hover:bg-surface-hover focus-visible:border-input-border-focused"
                      onClick={() => {
                        onOpenChannel(channel.provider);
                        logger.info("[WebRemoteControlDialog] 打开 Bot Channel 配置入口", {
                          workspacePath,
                          workspaceIdentity: workspaceIdentity ?? "none",
                          provider: channel.provider,
                        });
                      }}
                    >
                      <BotProviderIcon provider={channel.provider} className="size-12 shrink-0" />
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="flex min-w-0 items-center gap-1.5 text-ui-base font-medium text-foreground">
                          <span className="min-w-0 truncate">
                            {intl.formatMessage({
                              id: `webRemoteControl.botChannel.${channel.provider}.title`,
                            })}
                          </span>
                          {regionTag ? (
                            <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-border px-2 text-ui-xs leading-none font-medium text-foreground-subtle">
                              {intl.formatMessage({ id: regionTag })}
                            </span>
                          ) : null}
                        </span>
                        <span className="block text-ui-base/relaxed text-foreground-subtle">
                          {intl.formatMessage({
                            id: `webRemoteControl.botChannel.${channel.provider}.description`,
                          })}
                        </span>
                        <span className="block text-ui-base font-medium text-primary">
                          {intl.formatMessage({ id: "webRemoteControl.botChannel.configure" })}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  data-testid="web-remote-control-open-bots"
                  className="w-full justify-center gap-2 enabled:cursor-pointer"
                  onClick={() => {
                    onOpenBots();
                    logger.info("[WebRemoteControlDialog] 打开 Bots 总配置入口", {
                      workspacePath,
                      workspaceIdentity: workspaceIdentity ?? "none",
                    });
                  }}
                >
                  <Smartphone className="size-3.5" />
                  {intl.formatMessage({ id: "webRemoteControl.botChannel.manageBots" })}
                </Button>
              </div>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

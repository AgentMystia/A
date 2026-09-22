import { Loader2, RefreshCw, Copy, Lock } from "lucide-react";

import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

import { bindCountdownLabel } from "./botsDialogModel.js";

export function BotsBindCommandPanel({
  code,
  expired,
  remainingMs,
  progress,
  onRefresh,
  onCopy,
}: {
  code: string;
  expired: boolean;
  remainingMs: number;
  progress: number;
  onRefresh: () => void;
  onCopy: () => void;
}) {
  const { intl } = useZCodeIntl();
  const command = `/bind ${code}`;
  return (
    <div className="rounded-lg bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "bots.bindCommand" })}
          </div>
          <div className="mt-1 text-ui-base leading-5 text-foreground-subtle">
            {intl.formatMessage({ id: "bots.bindCommandGuide" })}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw className="size-3" />
          {intl.formatMessage({ id: "bots.setup.refreshBindCode" })}
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md bg-surface px-2 py-1.5">
        <span
          className={cn(
            "min-w-0 break-all font-mono text-ui-base leading-5",
            expired ? "text-foreground-subtle" : "text-foreground",
          )}
        >
          {command}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCopy}
          disabled={expired}
          title={intl.formatMessage({ id: "bots.copyBindCommand" })}
        >
          <Copy className="size-4" />
          {intl.formatMessage({ id: "bots.copyBindCommand" })}
        </Button>
      </div>
      <ol className="mt-2 list-decimal space-y-1 pl-4 text-ui-base leading-5 text-foreground-subtle">
        <li>{intl.formatMessage({ id: "bots.bindCommandStep.copy" })}</li>
        <li>{intl.formatMessage({ id: "bots.bindCommandStep.openChat" })}</li>
        <li>{intl.formatMessage({ id: "bots.bindCommandStep.send" })}</li>
      </ol>
      <div className="mt-2 flex items-center gap-2 text-ui-base text-foreground-subtle">
        <Lock className="size-3" />
        {expired
          ? intl.formatMessage({ id: "bots.bindCodeExpired" })
          : intl.formatMessage(
              { id: "bots.bindCodeExpires" },
              { time: bindCountdownLabel(remainingMs) },
            )}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface">
        <div
          key={code}
          className={cn(
            "h-full origin-left rounded-full transition-transform duration-300 ease-linear",
            expired
              ? "bg-border"
              : progress <= 10
                ? "bg-destructive"
                : remainingMs <= 10_000
                  ? "bg-warning"
                  : "bg-primary",
          )}
          style={{ transform: `scaleX(${progress / 100})` }}
        />
      </div>
    </div>
  );
}

export function BotsFeishuRegistrationPanel({
  qrDataUrl,
  domain,
  userCode,
  status,
  message,
}: {
  qrDataUrl: string | null;
  domain: string;
  userCode: string;
  status: string;
  message?: string;
}) {
  const { intl } = useZCodeIntl();
  return (
    <div className="rounded-lg bg-background p-3">
      <div className="flex flex-wrap items-start justify-center gap-4">
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt={intl.formatMessage({ id: "bots.feishuRegistrationQrAlt" })}
            className="size-40 shrink-0 rounded-lg border border-border bg-surface p-2"
          />
        ) : null}
        <div className="min-w-52 flex-1 space-y-3 text-ui-base text-foreground-subtle">
          <div>{intl.formatMessage({ id: `bots.feishuRegistrationScanHint.${domain}` })}</div>
          <div className="rounded-md bg-surface px-2 py-1 font-mono text-foreground">
            {userCode}
          </div>
          <div>
            {status === "pending" ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" />
                {intl.formatMessage({ id: "common.loading" })}
              </span>
            ) : (
              (message ?? intl.formatMessage({ id: `bots.feishuRegistration.${status}` }))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function BotsWeixinRegistrationPanel({
  qrDataUrl,
  status,
  message,
}: {
  qrDataUrl: string | null;
  status: string;
  message?: string;
}) {
  const { intl } = useZCodeIntl();
  const waiting = status === "pending" || status === "scanned";
  return (
    <div className="rounded-lg bg-background p-3">
      <div className="flex flex-wrap items-start justify-center gap-4">
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt={intl.formatMessage({ id: "bots.weixinRegistrationQrAlt" })}
            className="size-40 shrink-0 rounded-lg border border-border bg-surface p-2"
          />
        ) : null}
        <div className="min-w-52 flex-1 space-y-3 text-ui-base text-foreground-subtle">
          <div>{intl.formatMessage({ id: "bots.weixinRegistrationScanHint" })}</div>
          <div>
            {waiting ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" />
                {intl.formatMessage({ id: `bots.weixinRegistration.${status}` })}
              </span>
            ) : (
              (message ?? intl.formatMessage({ id: `bots.weixinRegistration.${status}` }))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

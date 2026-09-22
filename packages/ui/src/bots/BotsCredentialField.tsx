import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

import { TELEGRAM_BOT_FATHER_URL } from "./botsDialogModel.js";

export function BotsCredentialField({
  credentialValue,
  secretSaving,
  onCredentialValueChange,
  onSaveSecret,
}: {
  credentialValue: string;
  secretSaving: boolean;
  onCredentialValueChange: (value: string) => void;
  onSaveSecret: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(TELEGRAM_BOT_FATHER_URL, { margin: 1, width: 220 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch((error: unknown) => {
        logger.error(
          "[BotsDialog] 生成 Telegram BotFather 二维码失败",
          error instanceof Error ? error.message : String(error),
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-lg bg-background p-3">
      <div className="flex flex-wrap items-start justify-center gap-4">
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt={intl.formatMessage({ id: "bots.telegramBotFatherQrAlt" })}
            className="size-40 shrink-0 rounded-lg border border-border bg-surface p-2"
          />
        ) : null}
        <div className="min-w-52 flex-1 space-y-3 text-ui-base text-foreground-subtle">
          <div>{intl.formatMessage({ id: "bots.telegramBotFatherScanHint" })}</div>
          <div className="rounded-md bg-surface px-2 py-1 font-mono text-foreground">
            @BotFather
          </div>
          <div className="flex w-full min-w-0 items-center gap-2">
            <Input
              size="lg"
              type="password"
              value={credentialValue}
              onChange={(event) => onCredentialValueChange(event.target.value)}
              placeholder={intl.formatMessage({ id: "bots.credentialPlaceholder" })}
              className="min-w-0 flex-1"
              disabled={secretSaving}
            />
            <Button
              variant="outline"
              size="lg"
              onClick={onSaveSecret}
              disabled={secretSaving || !credentialValue.trim()}
            >
              {secretSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {intl.formatMessage({ id: "bots.saveSecret" })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

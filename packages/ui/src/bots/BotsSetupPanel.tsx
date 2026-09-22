import { ExternalLink, Loader2, RefreshCw, TriangleAlert, Unlink } from "lucide-react";
import { isFeishuBotProvider, type BotConfigEntry, type BotRuntimeStatus } from "@zcode/shared";

import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

import { BotsCredentialField } from "./BotsCredentialField.js";
import {
  BotsBindCommandPanel,
  BotsFeishuRegistrationPanel,
  BotsWeixinRegistrationPanel,
} from "./BotsRegistrationPanels.js";
import { runtimeErrorCode } from "./botsDialogModel.js";
import type {
  BindCodeView,
  FeishuRegistrationView,
  WeixinRegistrationView,
} from "./botsDialogTypes.js";

export function BotsSetupPanel({
  bot,
  runtime,
  credentialValue,
  bindCode,
  bindExpired,
  bindRemainingMs,
  bindCountdownProgress,
  feishuRegistration,
  feishuRegistrationLoading,
  weixinRegistration,
  weixinRegistrationLoading,
  weixinActivated,
  secretSaving,
  onCredentialValueChange,
  onSaveSecret,
  onRemoveSecret,
  onOpenTelegramBotFather,
  onStartWeixinRegistration,
  onStartFeishuRegistration,
  onCreateBindCode,
  onUnbind,
  onCopyBindCommand,
}: {
  bot: BotConfigEntry;
  runtime?: BotRuntimeStatus;
  credentialValue: string;
  bindCode: BindCodeView | null;
  bindExpired: boolean;
  bindRemainingMs: number;
  bindCountdownProgress: number;
  feishuRegistration: FeishuRegistrationView | null;
  feishuRegistrationLoading: boolean;
  weixinRegistration: WeixinRegistrationView | null;
  weixinRegistrationLoading: boolean;
  weixinActivated: boolean;
  secretSaving: boolean;
  onCredentialValueChange: (value: string) => void;
  onSaveSecret: () => void;
  onRemoveSecret: () => void;
  onOpenTelegramBotFather: () => void;
  onStartWeixinRegistration: () => void;
  onStartFeishuRegistration: () => void;
  onCreateBindCode: () => void;
  onUnbind: () => void;
  onCopyBindCommand: () => void;
}) {
  const { intl } = useZCodeIntl();
  if (bot.provider === "webhook") return null;
  const hasCredential = Boolean(bot.credentialRef);
  const feishu = isFeishuBotProvider(bot.provider);
  const weixin = bot.provider === "weixin";
  const connected = weixin ? hasCredential : Boolean(bot.providerUserId);
  const runtimeError = runtime?.status === "error";
  const description = intl.formatMessage({
    id:
      feishu && runtimeError
        ? connected
          ? "bots.runtime.boundConnectionInterruptedDescription"
          : "bots.runtime.credentialsSavedConnectionFailedDescription"
        : `bots.botTokenDescription.${bot.provider}`,
  });
  const feishuForBot = feishuRegistration?.botId === bot.id ? feishuRegistration : null;
  const weixinForBot = weixinRegistration?.botId === bot.id ? weixinRegistration : null;
  const bindForBot = bindCode?.botId === bot.id ? bindCode : null;
  const control = renderControl({
    bot,
    connected,
    runtimeError,
    hasCredential,
    feishu,
    weixin,
    bindForBot,
    feishuRegistrationLoading,
    weixinRegistrationLoading,
    intl,
    onUnbind,
    onRemoveSecret,
    onOpenTelegramBotFather,
    onStartWeixinRegistration,
    onStartFeishuRegistration,
    onCreateBindCode,
  });
  const detail = renderDetail({
    bot,
    connected,
    runtime,
    runtimeError,
    feishu,
    weixin,
    weixinActivated,
    hasCredential,
    credentialValue,
    secretSaving,
    bindForBot,
    bindExpired,
    bindRemainingMs,
    bindCountdownProgress,
    feishuForBot,
    weixinForBot,
    intl,
    onCredentialValueChange,
    onSaveSecret,
    onCreateBindCode,
    onCopyBindCommand,
  });
  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "bots.botToken" })}
        description={description}
        control={control}
        detail={detail}
      />
    </SettingsGroupCard>
  );
}

function renderControl(input: {
  bot: BotConfigEntry;
  connected: boolean;
  runtimeError: boolean;
  hasCredential: boolean;
  feishu: boolean;
  weixin: boolean;
  bindForBot: BindCodeView | null;
  feishuRegistrationLoading: boolean;
  weixinRegistrationLoading: boolean;
  intl: { formatMessage: (descriptor: { id: string }) => string };
  onUnbind: () => void;
  onRemoveSecret: () => void;
  onOpenTelegramBotFather: () => void;
  onStartWeixinRegistration: () => void;
  onStartFeishuRegistration: () => void;
  onCreateBindCode: () => void;
}) {
  const { intl } = input;
  if (input.connected) {
    return (
      <div className="flex items-center justify-end gap-3">
        <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-ui-base text-foreground-subtle">
          <span
            className={cn(
              "size-2 rounded-full",
              input.runtimeError ? "bg-destructive" : "bg-success",
            )}
          />
          {intl.formatMessage({
            id: input.runtimeError ? "bots.runtime.boundConnectionInterrupted" : "bots.connected",
          })}
        </span>
        <Button
          variant="outline"
          size="lg"
          onClick={input.weixin ? input.onRemoveSecret : input.onUnbind}
        >
          <Unlink className="size-4" />
          {intl.formatMessage({ id: "bots.unbind" })}
        </Button>
      </div>
    );
  }
  if (input.bot.provider === "telegram" && !input.hasCredential) {
    return (
      <Button variant="outline" size="lg" onClick={input.onOpenTelegramBotFather}>
        <ExternalLink className="size-4" />
        {intl.formatMessage({ id: "bots.openBotFather" })}
      </Button>
    );
  }
  if ((input.feishu && !input.hasCredential) || (input.weixin && !input.hasCredential)) {
    const loading = input.weixin
      ? input.weixinRegistrationLoading
      : input.feishuRegistrationLoading;
    return (
      <Button
        variant="outline"
        size="lg"
        onClick={input.weixin ? input.onStartWeixinRegistration : input.onStartFeishuRegistration}
        disabled={loading}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {intl.formatMessage({ id: "bots.scanQrCode" })}
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-wrap justify-end gap-2">
      {!input.bindForBot && !input.runtimeError ? (
        <Button variant="outline" size="lg" onClick={input.onCreateBindCode}>
          {intl.formatMessage({ id: "bots.bind" })}
        </Button>
      ) : null}
      <Button variant="outline" size="lg" onClick={input.onRemoveSecret}>
        {intl.formatMessage({ id: "bots.removeSecret" })}
      </Button>
    </div>
  );
}

function renderDetail(input: {
  bot: BotConfigEntry;
  connected: boolean;
  runtime?: BotRuntimeStatus;
  runtimeError: boolean;
  feishu: boolean;
  weixin: boolean;
  weixinActivated: boolean;
  hasCredential: boolean;
  credentialValue: string;
  secretSaving: boolean;
  bindForBot: BindCodeView | null;
  bindExpired: boolean;
  bindRemainingMs: number;
  bindCountdownProgress: number;
  feishuForBot: FeishuRegistrationView | null;
  weixinForBot: WeixinRegistrationView | null;
  intl: {
    formatMessage: (descriptor: { id: string }, values?: Record<string, string | number>) => string;
  };
  onCredentialValueChange: (value: string) => void;
  onSaveSecret: () => void;
  onCreateBindCode: () => void;
  onCopyBindCommand: () => void;
}) {
  let body = null;
  if (input.connected && input.weixin && !input.weixinActivated) {
    body = (
      <div className="rounded-lg bg-background p-3">
        <div className="text-ui-base text-foreground-subtle">
          {input.intl.formatMessage({ id: "bots.weixinActivationHint" })}
        </div>
      </div>
    );
  } else if (input.bot.provider === "telegram" && !input.hasCredential) {
    body = (
      <BotsCredentialField
        credentialValue={input.credentialValue}
        secretSaving={input.secretSaving}
        onCredentialValueChange={input.onCredentialValueChange}
        onSaveSecret={input.onSaveSecret}
      />
    );
  }
  if (input.feishu && input.runtimeError) {
    const code = runtimeErrorCode(input.runtime?.message);
    const lark = input.bot.provider === "lark";
    body = (
      <div className="rounded-lg bg-background p-3">
        <div className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="text-ui-base font-medium text-foreground">
              {input.intl.formatMessage({
                id: input.connected
                  ? lark
                    ? "bots.runtime.larkConnectionInterrupted"
                    : "bots.runtime.feishuConnectionInterrupted"
                  : lark
                    ? "bots.runtime.cannotConnectLark"
                    : "bots.runtime.cannotConnectFeishu",
              })}
            </div>
            <div className="mt-1 text-ui-base leading-5 text-foreground-subtle">
              {input.intl.formatMessage({
                id: input.connected
                  ? lark
                    ? "bots.runtime.larkConnectionRecoverySuggestion"
                    : "bots.runtime.feishuConnectionRecoverySuggestion"
                  : "bots.runtime.connectionBlocksBinding",
              })}
            </div>
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-ui-base leading-5">
              {code ? (
                <>
                  <dt className="text-foreground-subtle">
                    {input.intl.formatMessage({ id: "bots.runtime.errorCode" })}
                  </dt>
                  <dd className="min-w-0 break-all font-mono text-foreground">{code}</dd>
                </>
              ) : null}
              <dt className="text-foreground-subtle">
                {input.intl.formatMessage({ id: "bots.runtime.errorDetail" })}
              </dt>
              <dd className="min-w-0 break-words text-foreground">
                {input.runtime?.message ??
                  input.intl.formatMessage({ id: "bots.runtime.unknownError" })}
              </dd>
            </dl>
          </div>
        </div>
      </div>
    );
  } else if (input.bindForBot) {
    body = (
      <BotsBindCommandPanel
        code={input.bindForBot.code}
        expired={input.bindExpired}
        remainingMs={input.bindRemainingMs}
        progress={input.bindCountdownProgress}
        onRefresh={input.onCreateBindCode}
        onCopy={input.onCopyBindCommand}
      />
    );
  } else if (input.feishuForBot) {
    body = (
      <BotsFeishuRegistrationPanel
        qrDataUrl={input.feishuForBot.qrDataUrl}
        domain={input.feishuForBot.domain}
        userCode={input.feishuForBot.userCode}
        status={input.feishuForBot.status}
        message={input.feishuForBot.message}
      />
    );
  } else if (input.weixinForBot) {
    body = (
      <BotsWeixinRegistrationPanel
        qrDataUrl={input.weixinForBot.qrDataUrl}
        status={input.weixinForBot.status}
        message={input.weixinForBot.message}
      />
    );
  }
  if (input.bot.enabled && input.runtime?.deliveryError) {
    return (
      <>
        <div className="rounded-lg bg-background p-3">
          <div role="alert" className="min-w-0 space-y-2 text-ui-base">
            <div className="font-medium text-destructive">
              {input.intl.formatMessage({ id: "bots.runtime.deliveryFailed" })}
            </div>
            <div className="text-foreground-subtle">
              {input.intl.formatMessage({ id: "bots.runtime.deliveryFailedDescription" })}
            </div>
            <div className="whitespace-pre-wrap break-all text-foreground-subtle">
              {input.runtime.deliveryError}
            </div>
          </div>
        </div>
        {body}
      </>
    );
  }
  return body;
}

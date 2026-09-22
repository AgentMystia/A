import { Bot, Loader2, Plus } from "lucide-react";
import type { BotProviderId } from "@zcode/shared";

import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";

import { BotsAllowedWorkspaces } from "./BotsAllowedWorkspaces.js";
import { BotsBotHeader } from "./BotsBotHeader.js";
import { BotProviderIcon } from "./BotProviderIcon.js";
import { BotsDeleteRow, BotsReplyGranularity } from "./BotsReplyAndDelete.js";
import { BotsSetupPanel } from "./BotsSetupPanel.js";
import {
  botChannelRegionTag,
  botDisplayName,
  NEW_BOT_CATALOG,
  runtimeDotClass,
} from "./botsDialogModel.js";
import { useBotsDialogController } from "./useBotsDialogController.js";

export function BotsDialog({
  open,
  onOpenChange,
  workspacePath,
  workspaceIdentity,
  entryProvider,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspacePath: string;
  workspaceIdentity?: string;
  entryProvider?: BotProviderId | null;
}) {
  const { intl } = useZCodeIntl();
  const controller = useBotsDialogController({
    open,
    workspacePath,
    workspaceIdentity,
    entryProvider,
  });
  const channelLabel = (provider: string) => intl.formatMessage({ id: `bots.channel.${provider}` });
  const channelName = (provider: string) => {
    const region = botChannelRegionTag(provider);
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate">{channelLabel(provider)}</span>
        {region ? (
          <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-border px-2 text-ui-xs leading-none font-medium text-foreground-subtle">
            {intl.formatMessage({ id: region })}
          </span>
        ) : null}
      </span>
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[calc(100vh-6rem)] max-h-168 max-w-4xl flex-col overflow-hidden rounded-2xl"
        onEscapeKeyDown={controller.preventCloseWhileRenaming}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Bot className="size-5 text-foreground" />
            <DialogTitle className="text-lg font-medium text-foreground">
              {intl.formatMessage({ id: "bots.title" })}
            </DialogTitle>
            <DialogDescription className="ml-3">
              {intl.formatMessage({ id: "bots.description" })}
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 gap-3">
          <aside className="flex w-64 shrink-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={controller.startCreate}
                className="mb-3 w-full justify-start gap-2 rounded-xl"
              >
                <Plus className="size-4" />
                <span className="min-w-0 truncate">
                  {intl.formatMessage({ id: "bots.addBot" })}
                </span>
              </Button>
              {controller.config.bots.length === 0 ? (
                <div className="p-4 text-ui-base text-foreground-subtle">
                  {controller.creating
                    ? intl.formatMessage({ id: "bots.newBot.selectProviderHint" })
                    : intl.formatMessage({ id: "bots.empty" })}
                </div>
              ) : (
                controller.config.bots.map((bot) => {
                  const itemRuntime = controller.runtimeFor(bot.id);
                  return (
                    <button
                      key={bot.id}
                      type="button"
                      onClick={() => controller.selectBot(bot.id)}
                      className={cn(
                        "mb-1 w-full rounded-xl px-2.5 py-3 pr-4 text-left transition-colors",
                        bot.id === controller.selectedBot?.id
                          ? "bg-surface-hover text-foreground"
                          : "text-foreground-subtle hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <BotProviderIcon
                          provider={bot.provider}
                          className="size-10 shrink-0 object-contain text-foreground-subtle"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ui-base font-medium text-foreground">
                            {botDisplayName(bot.name, controller.fallbackName)}
                          </span>
                          <span className="mt-0.5 flex min-w-0 text-ui-base text-foreground-subtle">
                            {channelName(bot.provider)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            runtimeDotClass(itemRuntime, bot.enabled),
                          )}
                        />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>
          <section className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-border bg-background p-4">
            {controller.creating ? (
              <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-start gap-6">
                <div className="space-y-2">
                  <div className="text-ui-lg font-medium">
                    {intl.formatMessage({ id: "bots.newBot.title" })}
                  </div>
                  <p className="max-w-2xl text-ui-base leading-6 text-foreground-subtle">
                    {intl.formatMessage({ id: "bots.newBot.description" })}
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {NEW_BOT_CATALOG.filter((item) => item.id !== "webhook").map((item) => {
                    const busy = controller.creatingProvider === item.id;
                    const locked = controller.creatingProvider !== null;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!item.implemented || locked}
                        aria-busy={busy}
                        onClick={() => {
                          if (item.implemented && item.id !== "dingding")
                            void controller.createBot(item.id);
                        }}
                        className={cn(
                          "flex items-start gap-3 rounded-lg border border-card-border bg-card px-3 py-4 text-left transition-colors",
                          item.implemented && !locked
                            ? "hover:border-input-border-focused hover:bg-surface-hover"
                            : "cursor-not-allowed opacity-60",
                          busy && "border-input-border-focused bg-surface-hover opacity-100",
                        )}
                      >
                        {busy ? (
                          <div className="flex size-10 items-center justify-center">
                            <Loader2 className="size-6 shrink-0 animate-spin text-foreground-subtle" />
                          </div>
                        ) : (
                          <BotProviderIcon
                            provider={item.id}
                            className="size-10 shrink-0 text-foreground"
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 text-ui-lg font-medium">
                            {channelName(item.id)}
                          </span>
                          <span className="mt-1 block text-ui-base text-foreground-subtle">
                            {item.implemented
                              ? intl.formatMessage({
                                  id: `bots.newBot.providerDescription.${item.id}`,
                                })
                              : intl.formatMessage({ id: "bots.newBot.comingSoon" })}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : controller.selectedBot ? (
              <div className="space-y-4">
                <BotsBotHeader
                  bot={controller.selectedBot}
                  runtime={controller.runtime}
                  selectedBotDisplayName={controller.displayName}
                  selectedBotName={controller.nameValue}
                  fallbackBotName={controller.fallbackName}
                  renaming={controller.renaming}
                  onStartRename={controller.startRename}
                  onCommitNameDraft={controller.commitName}
                  onNameDraftChange={controller.changeName}
                  onNameCompositionEnd={controller.compositionEnd}
                  onNameCompositionStart={controller.compositionStart}
                  onNameInputKeyDown={controller.nameKeyDown}
                  onPatchBot={controller.patchBot}
                />
                <BotsSetupPanel
                  bot={controller.selectedBot}
                  runtime={controller.runtime}
                  credentialValue={controller.credentialDraft}
                  bindCode={controller.bindCode}
                  bindExpired={controller.bindExpired}
                  bindRemainingMs={controller.bindRemainingMs}
                  bindCountdownProgress={controller.bindCountdownProgress}
                  feishuRegistration={controller.feishuRegistration}
                  feishuRegistrationLoading={controller.feishuRegistrationLoading}
                  weixinRegistration={controller.weixinRegistration}
                  weixinRegistrationLoading={controller.weixinRegistrationLoading}
                  weixinActivated={controller.weixinActivated}
                  secretSaving={controller.secretSaving}
                  onCredentialValueChange={controller.setCredentialDraft}
                  onSaveSecret={() => void controller.saveSecret()}
                  onRemoveSecret={() => void controller.removeSecret()}
                  onOpenTelegramBotFather={controller.openBotFather}
                  onStartWeixinRegistration={controller.startWeixin}
                  onStartFeishuRegistration={controller.startFeishu}
                  onCreateBindCode={controller.createBindCode}
                  onUnbind={() => void controller.unbind()}
                  onCopyBindCommand={() => void controller.copyBindCommand()}
                />
                <SettingsGroupCard>
                  <BotsReplyGranularity
                    bot={controller.selectedBot}
                    onPatchBot={controller.patchBot}
                  />
                  <BotsAllowedWorkspaces
                    bot={controller.selectedBot}
                    workspaceRefs={controller.workspaceRefs}
                    currentWorkspace={controller.currentWorkspace}
                    loading={controller.workspaceSaving}
                    onPatchAllowedWorkspaces={(allowed) => void controller.patchAllowed(allowed)}
                    onToggleWorkspaceAccess={controller.toggleWorkspace}
                  />
                </SettingsGroupCard>
                <BotsDeleteRow onDelete={() => void controller.deleteBot()} />
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-ui-base text-foreground-subtle">
                <Bot className="size-8" />
                <div>{intl.formatMessage({ id: "bots.empty" })}</div>
                <Button variant="outline" size="lg" onClick={controller.startCreate}>
                  <Plus className="size-4" />
                  {intl.formatMessage({ id: "bots.addBot" })}
                </Button>
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

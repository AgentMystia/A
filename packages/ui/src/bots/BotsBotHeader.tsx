import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Lock } from "lucide-react";
import type { BotConfigEntry, BotRuntimeStatus } from "@zcode/shared";

import { cn } from "@/components/lib/utils.js";
import { Switch } from "@/components/ui/switch.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

import { BotProviderIcon } from "./BotProviderIcon.js";
import { runtimeDotClass, runtimeStatusText } from "./botsDialogModel.js";

export function BotsBotHeader({
  bot,
  runtime,
  selectedBotDisplayName,
  selectedBotName,
  fallbackBotName,
  renaming,
  onStartRename,
  onCommitNameDraft,
  onNameDraftChange,
  onNameCompositionEnd,
  onNameCompositionStart,
  onNameInputKeyDown,
  onPatchBot,
}: {
  bot: BotConfigEntry;
  runtime?: BotRuntimeStatus;
  selectedBotDisplayName: string;
  selectedBotName: string;
  fallbackBotName: string;
  renaming: boolean;
  onStartRename: () => void;
  onCommitNameDraft: () => void;
  onNameDraftChange: (value: string) => void;
  onNameCompositionEnd: () => void;
  onNameCompositionStart: () => void;
  onNameInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPatchBot: (patch: Partial<Pick<BotConfigEntry, "enabled" | "name" | "replyMode">>) => void;
}) {
  const { intl } = useZCodeIntl();
  const measureRef = useRef<HTMLButtonElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const bound = Boolean(bot.providerUserId);
  const statusText =
    runtime?.status === "error"
      ? intl.formatMessage({
          id:
            bot.provider === "feishu"
              ? "bots.runtime.feishuConnectionFailed"
              : bot.provider === "lark"
                ? "bots.runtime.larkConnectionFailed"
                : "bots.runtime.connectionFailed",
        })
      : bound
        ? runtimeStatusText(runtime, bot.enabled, (id) => intl.formatMessage({ id }))
        : intl.formatMessage({ id: "bots.unbound" });
  const widthText = selectedBotName || fallbackBotName;

  useLayoutEffect(() => {
    if (!renaming) {
      setMeasuredWidth(null);
      return;
    }
    const node = measureRef.current;
    if (!node) return;
    const measure = () => {
      setMeasuredWidth(Math.ceil(node.getBoundingClientRect().width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [renaming, widthText]);

  return (
    <div className="flex items-center gap-3 px-2 pb-2">
      <BotProviderIcon
        provider={bot.provider}
        className="size-12 shrink-0 text-foreground-subtle"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="min-w-0">
          {renaming ? (
            <label
              className="relative inline-block min-w-6 max-w-md align-middle"
              style={measuredWidth ? { width: `${measuredWidth}px` } : undefined}
            >
              <span className="sr-only">{intl.formatMessage({ id: "bots.name" })}</span>
              <button
                ref={measureRef}
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="pointer-events-none absolute top-0 left-0 invisible max-w-md overflow-hidden rounded-sm px-1 text-left text-ui-lg font-medium"
                style={{ whiteSpace: "pre" }}
              >
                {widthText}
              </button>
              <input
                autoFocus
                className="w-full min-w-0 truncate rounded-sm border-0 bg-transparent px-1 py-0 text-left text-ui-lg leading-normal font-medium text-foreground outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-input-border-focused"
                value={selectedBotName}
                onBlur={onCommitNameDraft}
                onChange={(event) => onNameDraftChange(event.target.value)}
                onCompositionEnd={onNameCompositionEnd}
                onCompositionStart={onNameCompositionStart}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={onNameInputKeyDown}
                placeholder={fallbackBotName}
              />
            </label>
          ) : (
            <button
              type="button"
              className="min-w-0 max-w-md truncate rounded-sm px-1 text-left text-ui-lg font-medium hover:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-input-border-focused"
              onClick={onStartRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") onStartRename();
              }}
            >
              {selectedBotDisplayName}
            </button>
          )}
        </div>
        <span className="inline-flex items-center gap-2 text-foreground-subtle">
          {bound || runtime?.status === "error" ? (
            <span className={cn("size-1.5 rounded-full", runtimeDotClass(runtime, bot.enabled))} />
          ) : (
            <Lock className="size-3 text-foreground-subtle" />
          )}
          {statusText}
        </span>
      </div>
      <div className="shrink-0">
        <Switch checked={bot.enabled} onCheckedChange={(enabled) => onPatchBot({ enabled })} />
      </div>
    </div>
  );
}

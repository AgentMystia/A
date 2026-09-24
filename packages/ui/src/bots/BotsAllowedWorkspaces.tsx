import { Check, Loader2 } from "lucide-react";
import type { BotConfigEntry, BotWorkspaceRef } from "@zcode/shared";

import { cn } from "@/components/lib/utils.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";

import { allowsAllWorkspaces } from "./botsDialogModel.js";

export function BotsAllowedWorkspaces({
  bot,
  workspaceRefs,
  currentWorkspace,
  loading,
  onPatchAllowedWorkspaces,
  onToggleWorkspaceAccess,
}: {
  bot: BotConfigEntry;
  workspaceRefs: BotWorkspaceRef[];
  currentWorkspace: BotWorkspaceRef;
  loading: boolean;
  onPatchAllowedWorkspaces: (allowed: string[]) => void;
  onToggleWorkspaceAccess: (workspaceId: string, allowed: boolean) => void;
}) {
  const { intl } = useZCodeIntl();
  const all = allowsAllWorkspaces(bot.allowedWorkspaces);
  const count = all
    ? workspaceRefs.length
    : bot.allowedWorkspaces.filter((id) => workspaceRefs.some((ref) => ref.id === id)).length;
  return (
    <SettingsRow
      label={intl.formatMessage({ id: "bots.allowedWorkspaces" })}
      description={intl.formatMessage(
        {
          id: all
            ? "bots.allowedWorkspaces.allDescription"
            : "bots.allowedWorkspaces.selectedDescription",
        },
        { count: String(count) },
      )}
      control={
        <div className="flex items-center justify-end gap-2">
          {loading ? <Loader2 className="size-4 animate-spin text-foreground-subtle" /> : null}
          <Select
            value={all ? "all" : "selected"}
            onValueChange={(value) => {
              onPatchAllowedWorkspaces(value === "all" ? ["*"] : [currentWorkspace.id]);
            }}
            disabled={loading}
          >
            <SelectTrigger size="lg" className="w-48 justify-between">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {intl.formatMessage({ id: "bots.allowedWorkspaces.mode.all" })}
              </SelectItem>
              <SelectItem value="selected">
                {intl.formatMessage({ id: "bots.allowedWorkspaces.mode.selected" })}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
      detail={
        all ? null : (
          <div className="rounded-lg bg-background p-1">
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {workspaceRefs.map((ref) => {
                const checked = bot.allowedWorkspaces.includes(ref.id);
                return (
                  <button
                    key={ref.id}
                    type="button"
                    className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => onToggleWorkspaceAccess(ref.id, !checked)}
                    disabled={loading}
                    title={ref.label}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center">
                      <div
                        className={cn(
                          "flex size-4 items-center justify-center rounded-sm border",
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input-border bg-input text-transparent",
                        )}
                      >
                        <Check className="size-3.5" />
                      </div>
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="truncate text-ui-base font-medium text-foreground">
                        {ref.label}
                      </div>
                      <div className="truncate font-mono text-ui-base text-foreground-subtlest">
                        {ref.workspacePath}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )
      }
    />
  );
}

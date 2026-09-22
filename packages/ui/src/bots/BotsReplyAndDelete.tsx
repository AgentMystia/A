import { Trash2 } from "lucide-react";
import type { BotConfigEntry, BotReplyMode } from "@zcode/shared";

import { Button } from "@/components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

import {
  currentReplyGranularity,
  isBotReplyMode,
  replyGranularityOptions,
} from "./botsDialogModel.js";

export function BotsReplyGranularity({
  bot,
  onPatchBot,
}: {
  bot: BotConfigEntry;
  onPatchBot: (patch: { replyMode: BotReplyMode }) => void;
}) {
  const { intl } = useZCodeIntl();
  const options = replyGranularityOptions(bot.provider);
  const current = currentReplyGranularity(bot.provider, bot.replyMode);
  return (
    <SettingsRow
      label={intl.formatMessage({ id: "bots.replyGranularity" })}
      description={intl.formatMessage({ id: current.descriptionId })}
      control={
        <Select
          value={current.id}
          onValueChange={(value) => {
            if (isBotReplyMode(value)) onPatchBot({ replyMode: value });
          }}
        >
          <SelectTrigger size="lg" className="w-48 justify-between">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {intl.formatMessage({ id: option.labelId })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

export function BotsDeleteRow({ onDelete }: { onDelete: () => void }) {
  const { intl } = useZCodeIntl();
  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "bots.delete" })}
        description={intl.formatMessage({ id: "bots.delete.description" })}
        control={
          <Button
            variant="destructive"
            size="lg"
            onClick={onDelete}
            title={intl.formatMessage({ id: "bots.delete" })}
          >
            <Trash2 className="size-4" />
            {intl.formatMessage({ id: "bots.delete" })}
          </Button>
        }
      />
    </SettingsGroupCard>
  );
}

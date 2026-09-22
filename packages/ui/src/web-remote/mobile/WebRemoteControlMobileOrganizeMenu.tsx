import { Clock3, FolderOpen, MessageCircleCheck, MessageCirclePlus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import type { WebRemoteControlMobileTaskHomePreferences } from "@/web-remote/mobile/webRemoteControlMobileTypes.js";

interface IntlLike {
  formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => string;
}

export function WebRemoteControlMobileOrganizeMenu({
  preferences,
  intl,
  onChange,
}: {
  preferences: WebRemoteControlMobileTaskHomePreferences;
  intl: IntlLike;
  onChange: (preferences: WebRemoteControlMobileTaskHomePreferences) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={intl.formatMessage({ id: "webRemoteControl.mobileHome.organize" })}
        >
          <Settings2 className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 min-w-52">
        <DropdownMenuLabel>
          {intl.formatMessage({ id: "webRemoteControl.mobileHome.organize" })}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preferences.organizeBy}
          onValueChange={(value) => {
            if (value === "workspace" || value === "timeline") {
              onChange({ ...preferences, organizeBy: value });
            }
          }}
        >
          <DropdownMenuRadioItem value="workspace">
            <FolderOpen className="size-4" />
            {intl.formatMessage({ id: "webRemoteControl.mobileHome.organizeByWorkspace" })}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="timeline">
            <Clock3 className="size-4" />
            {intl.formatMessage({ id: "webRemoteControl.mobileHome.organizeByTimeline" })}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>
          {intl.formatMessage({ id: "webRemoteControl.mobileHome.sortBy" })}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preferences.sortBy}
          onValueChange={(value) => {
            if (value === "created" || value === "updated") {
              onChange({ ...preferences, sortBy: value });
            }
          }}
        >
          <DropdownMenuRadioItem value="created">
            <MessageCirclePlus className="size-4" />
            {intl.formatMessage({ id: "webRemoteControl.mobileHome.sortByCreated" })}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="updated">
            <MessageCircleCheck className="size-4" />
            {intl.formatMessage({ id: "webRemoteControl.mobileHome.sortByUpdated" })}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { useState } from "react";
import { Smartphone } from "lucide-react";
import {
  buildWebRemoteControlEntryViewTelemetry,
  parseRemoteWorkspaceIdentity,
} from "@zcode/shared";

import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { reportAppTelemetryEvent } from "@/lib/appTelemetry.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

import { useWebRemoteControlFeatureEnabled } from "./webRemoteControlFeature.js";
import { webRemoteControlTriggerPresentation } from "./webRemoteControlFormat.js";
import { useWebRemoteControlStatus } from "./useWebRemoteControlStatus.js";
import { WebRemoteControlDialog } from "./WebRemoteControlDialog.js";

export function WorkspaceWebRemoteControlTrigger({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  initialTaskId,
  compact = false,
  className,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  initialTaskId?: string;
  compact?: boolean;
  className?: string;
}) {
  const enabled = useWebRemoteControlFeatureEnabled();
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const [open, setOpen] = useState(false);
  const status = useWebRemoteControlStatus({ enabled });
  if (!enabled) return null;
  const presentation = webRemoteControlTriggerPresentation(status, intl.formatMessage);
  const workspaceKind = workspaceIdentity?.trim() || remoteSessionId?.trim() ? "remote" : "local";
  const remoteKind = workspaceIdentity
    ? parseRemoteWorkspaceIdentity(workspaceIdentity)?.kind
    : undefined;
  return (
    <>
      <ControlHintTooltip
        title={intl.formatMessage({ id: "webRemoteControl.trigger" })}
        description={presentation.tooltip}
        side="top"
        align="center"
        triggerClassName={compact ? undefined : "w-full"}
      >
        <Button
          variant="ghost"
          size={compact ? "icon-lg" : "lg"}
          aria-label={intl.formatMessage({ id: "webRemoteControl.trigger" })}
          className={cn(
            compact
              ? "text-foreground hover:bg-surface-hover hover:text-foreground"
              : "w-full justify-start gap-2 text-foreground hover:bg-surface-hover hover:text-foreground",
            className,
          )}
          onClick={() => {
            void reportAppTelemetryEvent(
              platform,
              buildWebRemoteControlEntryViewTelemetry({ workspaceKind, remoteKind }),
              "web-remote-control-entry",
            );
            logger.info("[WorkspaceWebRemoteControlTrigger] 打开 Web 远程控制弹层", {
              workspacePath,
              workspaceIdentity: workspaceIdentity ?? "none",
              remoteSessionId: remoteSessionId ?? "none",
              initialTaskId: initialTaskId ?? "none",
            });
            setOpen(true);
          }}
        >
          <Smartphone className={cn("size-4", presentation.iconClassName)} />
          {compact ? (
            <span className="sr-only">
              {intl.formatMessage({ id: "webRemoteControl.trigger" })}
            </span>
          ) : (
            intl.formatMessage({ id: "webRemoteControl.trigger" })
          )}
        </Button>
      </ControlHintTooltip>
      <WebRemoteControlDialog
        open={open}
        onOpenChange={setOpen}
        workspacePath={workspacePath}
        workspaceIdentity={workspaceIdentity}
        remoteSessionId={remoteSessionId}
        initialTaskId={initialTaskId}
      />
    </>
  );
}

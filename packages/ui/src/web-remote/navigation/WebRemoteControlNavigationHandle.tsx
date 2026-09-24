import type { PointerEvent as ReactPointerEvent } from "react";
import { GripHorizontalIcon } from "lucide-react";

import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function WebRemoteControlNavigationHandle({
  hasHeader,
  isCollapsed,
  isDragging,
  onClick,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  hasHeader: boolean | undefined;
  isCollapsed: boolean;
  isDragging: boolean;
  onClick: () => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const { intl } = useZCodeIntl();

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-md"
      data-web-remote-navigation-resize-handle="true"
      className={cn(
        "absolute left-1/2 z-30 hidden -translate-x-1/2 -translate-y-1/2 touch-none cursor-ns-resize border-border bg-surface text-foreground-subtle shadow-sm hover:bg-surface-hover hover:text-foreground max-md:inline-flex [app-region:no-drag]",
        hasHeader ? "top-12" : "top-0",
        isDragging && "border-border-hover bg-surface-hover text-foreground",
      )}
      aria-expanded={!isCollapsed}
      aria-controls="web-remote-control-navigation-panel"
      aria-label={intl.formatMessage({
        id: isCollapsed
          ? "webRemoteControl.expandNavigation"
          : "webRemoteControl.collapseNavigation",
      })}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
    >
      <GripHorizontalIcon className="size-4" />
    </Button>
  );
}

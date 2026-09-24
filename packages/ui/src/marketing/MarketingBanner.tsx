import { useEffect, useState } from "react";
import { LoaderCircleIcon, XIcon } from "lucide-react";

import { Button } from "../components/ui/button.js";
import { CloudDialogInteractiveHero } from "./CloudDialogInteractiveHero.js";
import { CloudDialogVideoHero } from "./CloudDialogVideoHero.js";
import type {
  CloudDialogInteractiveHero as InteractiveHero,
  CloudDialogVideoHero as VideoHero,
} from "./cloudDialogModel.js";

export function MarketingBanner({
  src,
  bundle,
  video,
  locale,
  hasAction,
  hasClose,
  actionLabel,
  closeLabel,
  pending,
  pendingLabel,
  onClick,
  onClose,
}: {
  src?: string;
  bundle?: InteractiveHero;
  video?: VideoHero;
  locale?: string;
  hasAction: boolean;
  hasClose: boolean;
  actionLabel: string;
  closeLabel: string;
  pending: boolean;
  pendingLabel: string;
  onClick: () => void;
  onClose: () => void;
}) {
  const [bundleReady, setBundleReady] = useState(false);
  const [hovered, setHovered] = useState(false);
  const visible = !bundle || bundleReady;
  useEffect(() => {
    const clear = () => setHovered(false);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        clear();
      }
    };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return (
    <div
      className="relative w-full"
      data-testid="marketing-banner"
      aria-busy={pending}
      onPointerEnter={(event) => setHovered(event.pointerType === "mouse")}
      onPointerLeave={() => setHovered(false)}
      onPointerCancel={() => setHovered(false)}
      style={visible ? undefined : { height: 0, overflow: "hidden", visibility: "hidden" }}
    >
      <button
        type="button"
        disabled={!visible || pending || !hasAction}
        aria-label={hasAction ? actionLabel : undefined}
        onClick={onClick}
        className="block h-24 w-full overflow-hidden rounded-xl border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50 disabled:cursor-default"
      >
        {bundle ? (
          <span className="pointer-events-none block size-full overflow-hidden" aria-hidden inert>
            <CloudDialogInteractiveHero
              hero={bundle}
              locale={locale ?? "en-US"}
              title={actionLabel}
              presentation
              hovered={visible && !pending && hovered}
              onReadyChange={setBundleReady}
            />
          </span>
        ) : video ? (
          <span className="pointer-events-none block size-full overflow-hidden" aria-hidden inert>
            <CloudDialogVideoHero hero={video} title={actionLabel} presentation />
          </span>
        ) : (
          <img
            src={src}
            alt={hasAction ? actionLabel : ""}
            className="block size-full object-cover"
            draggable={false}
          />
        )}
      </button>
      {pending ? (
        <span
          role="status"
          className="absolute top-2.5 right-2.5 flex size-5 items-center justify-center rounded-full text-foreground"
        >
          <LoaderCircleIcon
            className="size-3.5 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
          <span className="sr-only">{pendingLabel}</span>
        </span>
      ) : hasClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={closeLabel}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="absolute top-2.5 right-2.5 rounded-full text-foreground-subtle hover:bg-hover hover:text-foreground focus-visible:ring-foreground/50"
        >
          <XIcon aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

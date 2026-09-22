import { useEffect, useRef, useState } from "react";

import { Button } from "../components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog.js";
import { cn } from "../components/lib/utils.js";
import { CloudDialogHeroView } from "./CloudDialogHeroView.js";
import type { CloudDialogAction, CloudDialogPayload } from "./cloudDialogModel.js";
import { MarketingDescription, MarketingRichText } from "./MarketingRichText.js";
import { sanitizeMarketingStyle } from "./marketingStyle.js";

export interface CloudDialogHandlers {
  copy_text?: (action: Extract<CloudDialogAction, { type: "copy_text" }>) => void | Promise<void>;
  navigate?: (
    action: Extract<CloudDialogAction, { type: "navigate" }>,
    actionId: string,
  ) => void | Promise<void>;
  open_external?: (
    action: Extract<CloudDialogAction, { type: "open_external" }>,
  ) => void | Promise<void>;
  claim_plan?: (action: Extract<CloudDialogAction, { type: "claim_plan" }>) => void | Promise<void>;
  dismiss_content?: (
    action: Extract<CloudDialogAction, { type: "dismiss_content" }>,
  ) => void | Promise<void>;
}

export interface CloudContentDialogProps {
  payload: CloudDialogPayload | null;
  open: boolean;
  onClose: () => void;
  handlers: CloudDialogHandlers;
  labels: { actionFailed: string; copySucceeded: string };
  actionPending?: boolean;
  returnFocusRef?: { current: HTMLElement | null };
}

async function runCloudDialogAction(
  action: CloudDialogAction,
  handlers: CloudDialogHandlers,
  actionId: string,
) {
  switch (action.type) {
    case "close":
      return;
    case "copy_text":
      return handlers.copy_text?.(action);
    case "navigate":
      return handlers.navigate?.(action, actionId);
    case "open_external":
      return handlers.open_external?.(action);
    case "claim_plan":
      return handlers.claim_plan?.(action);
    case "dismiss_content":
      return handlers.dismiss_content?.(action);
    default:
      return;
  }
}

export function CloudContentDialog(props: CloudContentDialogProps) {
  if (!props.open || !props.payload) {
    return null;
  }
  return (
    <CloudContentDialogBody
      {...props}
      payload={props.payload}
      key={`${props.payload.id}:${props.payload.revision}`}
    />
  );
}

function CloudContentDialogBody({
  payload,
  open,
  onClose,
  handlers,
  labels,
  actionPending = false,
  returnFocusRef,
}: CloudContentDialogProps & { payload: CloudDialogPayload }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copiedActionId, setCopiedActionId] = useState<string | undefined>();
  const lockRef = useRef(false);
  const rememberedFocusRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!copiedActionId) {
      return undefined;
    }
    const timer = setTimeout(() => setCopiedActionId(undefined), 2000);
    return () => clearTimeout(timer);
  }, [copiedActionId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runAction = async (action: CloudDialogAction, actionId?: string) => {
    if (action.type === "close") {
      onClose();
      return;
    }
    if (actionPending || lockRef.current || !handlers[action.type]) {
      return;
    }
    lockRef.current = true;
    setPending(true);
    setFailed(false);
    try {
      await runCloudDialogAction(action, handlers, actionId ?? "");
      if (mountedRef.current && action.type === "copy_text") {
        setCopiedActionId(actionId);
      }
      if (mountedRef.current && action.type === "dismiss_content") {
        onClose();
      }
    } catch {
      if (mountedRef.current) {
        setFailed(true);
      }
    } finally {
      lockRef.current = false;
      if (mountedRef.current) {
        setPending(false);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        ref={contentRef}
        data-testid="cloud-content-dialog"
        overlayClassName={
          payload.dialog.hero?.type === "interactive_bundle" ? "backdrop-filter-none!" : undefined
        }
        onOpenAutoFocus={(event) => {
          rememberedFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          if (payload.dialog.hero?.type !== "interactive_bundle") {
            return;
          }
          const closeButton = contentRef.current?.querySelector<HTMLElement>(
            '[data-slot="dialog-close"]',
          );
          if (closeButton) {
            event.preventDefault();
            closeButton.focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocusRef?.current ?? rememberedFocusRef.current;
          if (target?.isConnected) {
            target.focus();
          }
        }}
        className="cloud-content-dialog max-h-[calc(100dvh-2rem)] w-[min(480px,calc(100vw-2rem))] max-w-none gap-0 overflow-y-auto border-0 p-0 [&_[data-slot=dialog-close]]:rounded-full"
      >
        {payload.dialog.hero ? (
          <div
            className="aspect-[4/3] w-full overflow-hidden rounded-t-2xl bg-surface"
            data-testid="cloud-dialog-hero-slot"
          >
            <CloudDialogHeroView
              hero={payload.dialog.hero}
              locale={payload.locale}
              title={payload.dialog.title}
            />
          </div>
        ) : null}
        <section className="flex min-w-0 flex-col items-center gap-6 bg-popover px-6 py-7 text-center text-foreground">
          <div
            data-testid="cloud-dialog-status"
            className="flex w-full min-w-0 flex-col items-center gap-3"
          >
            <DialogTitle className="text-ui-xl font-semibold">
              <MarketingRichText
                inline
                text={
                  payload.dialog.formattedTitle ?? {
                    format: "plain_text",
                    text: payload.dialog.title,
                  }
                }
              />
            </DialogTitle>
            <DialogDescription asChild>
              <MarketingDescription
                data-testid="cloud-dialog-description"
                className="text-center text-ui-base/relaxed text-foreground-subtle"
                description={payload.dialog.description}
                onOpenExternal={
                  handlers.open_external
                    ? (url) => {
                        void runAction({ type: "open_external", url });
                      }
                    : undefined
                }
              />
            </DialogDescription>
          </div>
          {failed ? (
            <div role="alert" className="text-ui-sm text-destructive">
              {labels.actionFailed}
            </div>
          ) : null}
          <div className="flex w-full flex-wrap items-center justify-center gap-2">
            {payload.dialog.buttons.map((button) => {
              const action = Object.hasOwn(payload.actions, button.actionId)
                ? payload.actions[button.actionId]
                : undefined;
              const enabled = Boolean(action && (action.type === "close" || handlers[action.type]));
              return (
                <Button
                  key={button.id}
                  data-testid="cloud-dialog-action"
                  data-action-id={button.actionId}
                  size="lg"
                  className={cn(
                    "h-10 min-w-32 max-w-full whitespace-normal rounded-full px-6 text-ui-base",
                    button.theme.class,
                  )}
                  style={sanitizeMarketingStyle(button.theme.style ?? null)}
                  variant={
                    button.theme.variant ??
                    (button.variant === "primary" ? "default" : button.variant)
                  }
                  disabled={!enabled || ((pending || actionPending) && action?.type !== "close")}
                  onClick={() => {
                    if (action) void runAction(action, button.actionId);
                  }}
                >
                  {copiedActionId === button.actionId && labels.copySucceeded ? (
                    labels.copySucceeded
                  ) : (
                    <span className="min-w-0 break-words">
                      <MarketingRichText
                        inline
                        text={button.formattedLabel ?? { format: "plain_text", text: button.label }}
                      />
                    </span>
                  )}
                </Button>
              );
            })}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

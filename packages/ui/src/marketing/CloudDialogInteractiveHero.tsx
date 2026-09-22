import { useCallback, useEffect, useRef, useState } from "react";

import { CloudDialogImageHero } from "./CloudDialogImageHero.js";
import {
  CLOUD_HERO_CHANNEL,
  readCloudHeroInboundMessage,
  type CloudDialogInteractiveHero,
} from "./cloudDialogModel.js";

let nextCloudHeroInstance = 0;

function readCloudHeroTheme(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function readReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function CloudDialogInteractiveHero({
  hero,
  locale,
  title,
  onAction,
  presentation = false,
  hovered = false,
  onReadyChange,
}: {
  hero: CloudDialogInteractiveHero;
  locale: string;
  title: string;
  onAction?: (eventId: string) => void;
  presentation?: boolean;
  hovered?: boolean;
  onReadyChange?: (ready: boolean) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [instanceId] = useState(() => {
    nextCloudHeroInstance += 1;
    return `cloud-hero-${nextCloudHeroInstance}`;
  });
  const [status, setStatus] = useState("loading");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    onReadyChange?.(status === "ready" || (status === "error" && Boolean(hero.fallback)));
  }, [status, hero.fallback, onReadyChange]);

  useEffect(() => {
    timeoutRef.current = setTimeout(() => setStatus("error"), 5000);
    return () => clearTimeout(timeoutRef.current);
  }, []);

  const post = useCallback((message: object) => {
    frameRef.current?.contentWindow?.postMessage(message, "*");
  }, []);

  useEffect(() => {
    if (!presentation || status !== "ready") {
      return undefined;
    }
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const send = () => {
      post({
        channel: CLOUD_HERO_CHANNEL,
        type: "hover",
        instanceId,
        hovered: hovered && !media?.matches,
      });
    };
    send();
    media?.addEventListener("change", send);
    return () => media?.removeEventListener("change", send);
  }, [hovered, instanceId, post, presentation, status]);

  const sendInit = useCallback(() => {
    post({
      channel: CLOUD_HERO_CHANNEL,
      type: "init",
      instanceId,
      theme: readCloudHeroTheme(),
      locale,
      reducedMotion: readReducedMotion(),
      data: hero.data,
    });
  }, [hero.data, instanceId, locale, post]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        frameRef.current?.contentWindow == null ||
        event.source !== frameRef.current.contentWindow
      ) {
        return;
      }
      const message = readCloudHeroInboundMessage(event.data);
      if (!message || message.instanceId !== instanceId) {
        return;
      }
      switch (message.type) {
        case "ready":
          clearTimeout(timeoutRef.current);
          setStatus("ready");
          return;
        case "action": {
          const eventId = hero.events[message.id];
          if (!presentation && eventId !== undefined && Object.hasOwn(hero.events, message.id)) {
            onAction?.(eventId);
          }
          return;
        }
        case "error":
          clearTimeout(timeoutRef.current);
          setStatus("error");
          return;
        case "resize":
          return;
        default:
          return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [hero.events, instanceId, onAction, presentation]);

  useEffect(() => {
    const send = () => {
      post({
        channel: CLOUD_HERO_CHANNEL,
        type: "visibility",
        instanceId,
        visible: document.visibilityState !== "hidden",
      });
    };
    document.addEventListener("visibilitychange", send);
    return () => document.removeEventListener("visibilitychange", send);
  }, [instanceId, post]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      post({ channel: CLOUD_HERO_CHANNEL, type: "theme", instanceId, theme: readCloudHeroTheme() });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [instanceId, post]);

  useEffect(() => {
    const frame = frameRef.current;
    return () => {
      frame?.contentWindow?.postMessage(
        { channel: CLOUD_HERO_CHANNEL, type: "destroy", instanceId },
        "*",
      );
    };
  }, [instanceId]);

  if (status === "error") {
    if (hero.fallback && presentation) {
      return <img src={hero.fallback.src} alt="" className="size-full object-contain" />;
    }
    if (hero.fallback) {
      return <CloudDialogImageHero hero={hero.fallback} />;
    }
    return <div data-testid="cloud-dialog-hero-error" className="size-full bg-surface" />;
  }

  return (
    <iframe
      ref={frameRef}
      src={hero.resolvedUrl}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      data-testid="cloud-dialog-interactive-hero"
      data-hero-type={hero.type}
      data-instance-id={instanceId}
      data-status={status}
      onLoad={sendInit}
      onError={() => setStatus("error")}
      tabIndex={presentation ? -1 : undefined}
      aria-hidden={presentation || undefined}
      className={
        presentation
          ? "pointer-events-none size-full border-0 bg-transparent"
          : "size-full border-0 bg-surface"
      }
    />
  );
}

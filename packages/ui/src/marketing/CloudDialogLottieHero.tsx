import { useEffect, useRef, useState } from "react";

import { CloudDialogImageHero } from "./CloudDialogImageHero.js";
import { fetchLottieDocument } from "./lottieDocument.js";
import type { CloudDialogLottieHero } from "./cloudDialogModel.js";
import { useCloudDialogMotion } from "./useCloudDialogMotion.js";

interface LottieAnimationItem {
  setSpeed(speed: number): void;
  play(): void;
  pause(): void;
  goToAndStop(value: number, isFrame: boolean): void;
  destroy(): void;
  isLoaded: boolean;
  addEventListener(name: string, callback: () => void): void;
}

export function CloudDialogLottieHero({
  hero,
  title,
}: {
  hero: CloudDialogLottieHero;
  title: string;
}) {
  const motion = useCloudDialogMotion();
  const src = motion.dark && hero.darkSrc ? hero.darkSrc : hero.src;
  return (
    <CloudDialogLottieFrame
      hero={hero}
      src={src}
      title={title}
      animate={motion.animate}
      key={`${src}:${hero.loop}:${hero.speed}`}
    />
  );
}

function CloudDialogLottieFrame({
  hero,
  src,
  title,
  animate,
}: {
  hero: CloudDialogLottieHero;
  src: string;
  title: string;
  animate: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<LottieAnimationItem | null>(null);
  const playbackRef = useRef({ animate, autoplay: hero.autoplay });
  playbackRef.current = { animate, autoplay: hero.autoplay };
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const controller = new AbortController();
    let animation: LottieAnimationItem | undefined;
    const destroy = () => {
      animation?.destroy();
      animation = undefined;
      animationRef.current = null;
    };
    const timer = window.setTimeout(() => {
      controller.abort();
      destroy();
      setStatus("error");
    }, 10_000);
    void Promise.all([
      import("lottie-web/build/player/lottie_light_canvas.js").then(
        (module) =>
          module as unknown as { default: { loadAnimation(options: object): LottieAnimationItem } },
      ),
      fetchLottieDocument(src, controller.signal),
    ])
      .then(([lottie, animationData]) => {
        if (controller.signal.aborted || !containerRef.current) {
          return;
        }
        animation = lottie.default.loadAnimation({
          container: containerRef.current,
          renderer: "canvas",
          autoplay: false,
          loop: hero.loop ?? false,
          animationData,
        });
        animationRef.current = animation;
        animation.setSpeed(Math.max(0.1, Math.min(4, hero.speed ?? 1)));
        const ready = () => {
          window.clearTimeout(timer);
          if (!controller.signal.aborted) {
            setStatus("ready");
          }
        };
        const failed = () => {
          window.clearTimeout(timer);
          destroy();
          if (!controller.signal.aborted) {
            setStatus("error");
          }
        };
        animation.addEventListener("DOMLoaded", ready);
        animation.addEventListener("data_failed", failed);
        animation.addEventListener("error", failed);
        if (animation.isLoaded) {
          ready();
        }
        if (playbackRef.current.animate && playbackRef.current.autoplay) {
          animation.play();
        } else {
          animation.goToAndStop(0, true);
        }
      })
      .catch(() => {
        destroy();
        if (!controller.signal.aborted) {
          setStatus("error");
        }
        window.clearTimeout(timer);
      });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      destroy();
    };
  }, [src, hero.loop, hero.speed]);

  useEffect(() => {
    if (animate && hero.autoplay) {
      animationRef.current?.play();
    } else {
      animationRef.current?.pause();
    }
  }, [animate, hero.autoplay]);

  if (status === "error" && hero.fallback) {
    return <CloudDialogImageHero hero={hero.fallback} />;
  }
  return (
    <div
      ref={containerRef}
      className="size-full"
      role="img"
      aria-label={title}
      data-testid="cloud-dialog-lottie-hero"
      data-status={status}
    />
  );
}

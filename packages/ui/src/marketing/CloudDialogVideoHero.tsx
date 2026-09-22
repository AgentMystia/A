import { useEffect, useRef, useState } from "react";

import { CloudDialogImageHero } from "./CloudDialogImageHero.js";
import type { CloudDialogVideoHero } from "./cloudDialogModel.js";
import { useCloudDialogMotion } from "./useCloudDialogMotion.js";

export function CloudDialogVideoHero({
  hero,
  title,
  presentation = false,
}: {
  hero: CloudDialogVideoHero;
  title: string;
  presentation?: boolean;
}) {
  const motion = useCloudDialogMotion();
  const src = motion.dark && hero.darkSrc ? hero.darkSrc : hero.src;
  return (
    <CloudDialogVideoFrame
      hero={hero}
      src={src}
      title={title}
      animate={motion.animate}
      presentation={presentation}
      key={src}
    />
  );
}

function CloudDialogVideoFrame({
  hero,
  src,
  title,
  animate,
  presentation,
}: {
  hero: CloudDialogVideoHero;
  src: string;
  title: string;
  animate: boolean;
  presentation: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return undefined;
    }
    if (animate && hero.autoplay) {
      video.play().catch(() => undefined);
    } else {
      video.pause();
    }
    return () => video.pause();
  }, [animate, hero.autoplay]);
  if (failed) {
    return (
      <CloudDialogImageHero
        hero={{ type: "image", src: hero.poster ?? "", alt: title, fit: hero.fit }}
      />
    );
  }
  return (
    <video
      ref={videoRef}
      src={src}
      poster={hero.poster}
      muted
      playsInline
      controls={!presentation}
      tabIndex={presentation ? -1 : undefined}
      loop={hero.loop}
      autoPlay={Boolean(hero.autoplay && animate)}
      preload="metadata"
      aria-label={title}
      data-testid="cloud-dialog-video-hero"
      onError={() => setFailed(true)}
      className={`size-full ${hero.fit === "contain" ? "object-contain" : "object-cover"}`}
    />
  );
}

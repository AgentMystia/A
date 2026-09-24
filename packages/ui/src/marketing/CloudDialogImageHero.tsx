import { useState } from "react";

import type { CloudDialogImageHero } from "./cloudDialogModel.js";
import { useCloudDialogMotion } from "./useCloudDialogMotion.js";

export function CloudDialogImageHero({ hero }: { hero: CloudDialogImageHero }) {
  const { dark } = useCloudDialogMotion();
  const src = dark && hero.darkSrc ? hero.darkSrc : hero.src;
  return <CloudDialogImageFrame hero={hero} src={src} key={src} />;
}

function CloudDialogImageFrame({ hero, src }: { hero: CloudDialogImageHero; src: string }) {
  const [status, setStatus] = useState("loading");
  return (
    <div
      className="size-full bg-surface"
      data-testid="cloud-dialog-image-hero"
      data-status={status}
    >
      {status === "error" ? (
        <div role="img" aria-label={hero.alt} className="size-full" />
      ) : (
        <img
          src={src}
          alt={hero.alt}
          referrerPolicy="no-referrer"
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
          className={`size-full ${hero.fit === "contain" ? "object-contain" : "object-cover"}`}
        />
      )}
    </div>
  );
}

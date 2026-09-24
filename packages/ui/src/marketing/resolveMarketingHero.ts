import type {
  CloudContentBundle,
  CloudContentPrepareResult,
  MarketingAssetRef,
  MarketingDelivery,
} from "@zcode/shared";

import { logger } from "../logger.js";
import type { CloudDialogHero } from "./cloudDialogModel.js";
import { projectMarketingHeroData } from "./cloudDialogModel.js";

type MarketingVisual = NonNullable<
  Extract<MarketingDelivery, { resource_position: "popup" }>["popup"]["hero"]
>;

export interface MarketingHeroMediaPort {
  readPublishedMedia(request: {
    asset: MarketingAssetRef;
    kind: "image" | "video";
  }): Promise<string>;
  prepare(request: { bundle: CloudContentBundle }): Promise<CloudContentPrepareResult>;
  release(request: { leaseId: string }): Promise<void>;
}

const emptyHero = { hero: null, release: async () => undefined };

async function decodeImage(src: string): Promise<string> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      image.src = "";
      reject(new Error("marketing_image_timeout"));
    }, 10_000);
    image.onload = () => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve();
    };
    image.onerror = () => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      reject(new Error("marketing_image_decode"));
    };
    image.src = src;
  });
  return src;
}

async function readImage(asset: MarketingAssetRef, media: MarketingHeroMediaPort): Promise<string> {
  return decodeImage(await media.readPublishedMedia({ asset, kind: "image" }));
}

async function readVideo(asset: MarketingAssetRef, media: MarketingHeroMediaPort): Promise<string> {
  const src = await media.readPublishedMedia({ asset, kind: "video" });
  const video = document.createElement("video");
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("marketing_video_timeout"));
    }, 10_000);
    video.onloadeddata = () => {
      finish();
      resolve();
    };
    video.onerror = () => {
      finish();
      reject(new Error("marketing_video_decode"));
    };
    video.preload = "auto";
    video.muted = true;
    video.src = src;
  });
  return src;
}

export async function resolveMarketingHero(input: {
  visual: MarketingVisual | null | undefined;
  media: MarketingHeroMediaPort | null | undefined;
  locale: string;
  desktop: boolean;
}): Promise<{ hero: CloudDialogHero | null; release: () => Promise<void> }> {
  if (!input.visual || !input.media) {
    return emptyHero;
  }
  const visual = input.visual;
  const media = input.media;
  const fallbackAsset =
    visual.type === "bundle"
      ? visual.bundle.fallback
      : visual.type === "video"
        ? visual.video.fallback
        : null;
  let fallbackSrc: string | undefined;
  if (fallbackAsset) {
    try {
      fallbackSrc = await readImage(fallbackAsset, media);
    } catch {
      fallbackSrc = undefined;
    }
  }
  try {
    if (visual.type === "image") {
      const src = await readImage(visual.image.default, media);
      const darkSrc = visual.image.dark
        ? await readImage(visual.image.dark, media).catch(() => undefined)
        : undefined;
      return { hero: { type: "image", src, darkSrc, alt: "" }, release: async () => undefined };
    }
    if (visual.type === "video") {
      const src = await readVideo(visual.video.src, media);
      return {
        hero: {
          type: "video",
          src,
          poster: fallbackSrc ?? "",
          muted: true,
          autoplay: true,
          loop: true,
        },
        release: async () => undefined,
      };
    }
    if (!input.desktop) {
      throw new Error("marketing_web_bundle_unavailable");
    }
    const bundle: CloudContentBundle = {
      format: "zip",
      url: visual.bundle.bundle.src,
      sha256: visual.bundle.bundle.sha256,
      entry: visual.bundle.entry,
    };
    const prepared = await media.prepare({ bundle });
    let released = false;
    return {
      hero: {
        type: "interactive_bundle",
        runtime: "zcode-hero-sandbox-v1",
        resolvedUrl: prepared.url,
        data: projectMarketingHeroData(visual.args, input.locale),
        events: { replay: "replay" },
        ...(fallbackSrc ? { fallback: { type: "image" as const, src: fallbackSrc, alt: "" } } : {}),
      },
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        await media.release({ leaseId: prepared.leaseId });
      },
    };
  } catch (error) {
    logger.warn("[marketing-touch] hero degraded", {
      reason: error instanceof Error ? error.message : "resource_failed",
    });
    return {
      hero: fallbackSrc ? { type: "image", src: fallbackSrc, alt: "" } : null,
      release: async () => undefined,
    };
  }
}

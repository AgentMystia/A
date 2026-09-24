import type { MarketingDelivery, MarketingTouchLocale } from "@zcode/shared";

import type { MarketingPreparedDelivery } from "./marketingTouchController.js";
import { resolveMarketingHero, type MarketingHeroMediaPort } from "./resolveMarketingHero.js";

type Prepared = Omit<MarketingPreparedDelivery, "scope">;

export async function prepareMarketingDelivery(input: {
  delivery: MarketingDelivery;
  media: MarketingHeroMediaPort | null;
  locale: MarketingTouchLocale;
  desktop: boolean;
}): Promise<Prepared> {
  const popupVisual =
    input.delivery.resource_position === "banner"
      ? input.delivery.banner.success_popup?.hero
      : input.delivery.popup.hero;
  const popupHero = resolveMarketingHero({
    visual: popupVisual,
    media: input.media,
    locale: input.locale,
    desktop: input.desktop,
  });
  const bannerHero =
    input.delivery.resource_position === "banner"
      ? resolveMarketingHero({
          visual: input.delivery.banner.background,
          media: input.media,
          locale: input.locale,
          desktop: input.desktop,
        })
      : undefined;
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await Promise.all([
      popupHero.then((hero) => hero.release()),
      bannerHero?.then((hero) => hero.release()),
    ]);
  };
  if (input.delivery.resource_position === "banner") {
    try {
      if (!input.media) throw new Error("marketing_resources_unavailable");
      const hero = (await bannerHero)?.hero;
      if (!hero) throw new Error("marketing_banner_unavailable");
      return {
        delivery: input.delivery,
        image: hero.type === "image" ? hero.src : undefined,
        darkImage: hero.type === "image" ? hero.darkSrc : undefined,
        bannerHero: hero.type === "interactive_bundle" || hero.type === "video" ? hero : undefined,
        hero: null,
        success: popupHero,
        release,
      };
    } catch (error) {
      await release();
      throw error;
    }
  }
  return { delivery: input.delivery, hero: (await popupHero).hero, release };
}

export function cloudContentMediaPort(
  service:
    | {
        readPublishedMedia: MarketingHeroMediaPort["readPublishedMedia"];
        prepare: MarketingHeroMediaPort["prepare"];
        release: MarketingHeroMediaPort["release"];
      }
    | null
    | undefined,
): MarketingHeroMediaPort | null {
  if (!service) return null;
  return service;
}

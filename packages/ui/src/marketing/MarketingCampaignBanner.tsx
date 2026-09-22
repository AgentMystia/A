import { useContext, useEffect } from "react";
import { useStore } from "zustand";

import { useOptionalServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { useZCodeStore } from "@/store/StoreProvider.js";

import { readMarketingPlainLabel } from "./marketingPlainLabel.js";
import { MarketingBanner } from "./MarketingBanner.js";
import { MarketingCampaignContext } from "./marketingCampaignContext.js";
import { prewarmMarketingCaptcha } from "./marketingClaimCaptcha.js";
import { useCloudDialogMotion } from "./useCloudDialogMotion.js";
import type { MarketingTouchController } from "./marketingTouchController.js";

function useMarketingCaptchaPrewarm(enabled: boolean) {
  const services = useOptionalServices();
  const userId = useZCodeStore((state) => state.user?.id);
  const subscription = services?.codingPlanSubscriptionService;
  const active = enabled && Boolean(userId) && Boolean(subscription);
  useEffect(() => {
    if (!active || !subscription) return;
    let started = false;
    const run = () => {
      if (started || document.visibilityState === "hidden") return;
      started = true;
      void prewarmMarketingCaptcha(subscription).catch(() => {
        logger.warn("[marketing-touch] captcha prewarm failed; click will retry");
      });
    };
    run();
    document.addEventListener("visibilitychange", run);
    return () => document.removeEventListener("visibilitychange", run);
  }, [active, subscription, userId]);
}

function MarketingCampaignBannerBody({ controller }: { controller: MarketingTouchController }) {
  const state = useStore(controller.store);
  const { dark } = useCloudDialogMotion();
  const { intl, locale } = useZCodeIntl();
  const banner = state.banner;
  const claimVisible = Boolean(
    banner?.delivery.resource_position === "banner" &&
    (banner.image || banner.bannerHero) &&
    banner.delivery.banner.buttons.find((button) => button.action.type !== "close")?.action.type ===
      "claim_zcode_plan",
  );
  useMarketingCaptchaPrewarm(claimVisible);
  if (
    !banner ||
    banner.delivery.resource_position !== "banner" ||
    (!banner.image && !banner.bannerHero)
  ) {
    return null;
  }
  const buttons = banner.delivery.banner.buttons;
  const action = buttons.find((button) => button.action.type !== "close");
  const close = buttons.find((button) => button.action.type === "close");
  return (
    <MarketingBanner
      src={dark && banner.darkImage ? banner.darkImage : banner.image}
      bundle={banner.bannerHero?.type === "interactive_bundle" ? banner.bannerHero : undefined}
      video={banner.bannerHero?.type === "video" ? banner.bannerHero : undefined}
      locale={locale}
      hasAction={Boolean(action)}
      hasClose={Boolean(close)}
      actionLabel={
        (action && readMarketingPlainLabel(action.text).trim()) ||
        intl.formatMessage({ id: "common.open" })
      }
      closeLabel={
        (close && readMarketingPlainLabel(close.text).trim()) ||
        intl.formatMessage({ id: "common.close" })
      }
      pending={state.pending}
      pendingLabel={intl.formatMessage({ id: `marketingTouch.${state.phase}` })}
      onClick={() => {
        void controller.clickBanner().catch(() => {
          logger.warn("[marketing-touch] action failed");
        });
      }}
      onClose={() => {
        void controller.closeBanner();
      }}
    />
  );
}

export function MarketingCampaignBanner() {
  const controller = useContext(MarketingCampaignContext);
  if (!controller) return null;
  return <MarketingCampaignBannerBody controller={controller} />;
}

import type { ICodingPlanSubscriptionService } from "@zcode/services";
import type { IPlatformService } from "@zcode/shared";

import { toast } from "@/components/ui/toast.js";
import { logger } from "@/logger.js";
import { setPendingSettingsSectionIntent } from "@/lib/settingsNavigation.js";
import { requestPluginStoreOpen } from "@/lib/pluginStoreNavigation.js";
import type { TabStore } from "@/store/tabStore.js";

import { readCaptchaRegion, verifyManualClaimCaptcha } from "./marketingClaimCaptcha.js";
import {
  acknowledgeMarketingNavigation,
  MARKETING_SETTINGS_SECTION,
  marketingNavigationStore,
  raceMarketingCapability,
  requestMarketingNavigation,
  type MarketingButtonAction,
} from "./marketingNavigation.js";
import type { MarketingExecuteResult, MarketingPhase } from "./marketingTouchController.js";

const CLAIM_TERMINAL_CODES = new Set([1001, 1002, 1003, 1004, 1005]);

export interface MarketingCampaignRuntime {
  desktop: boolean;
  platform: Pick<IPlatformService, "openExternal">;
  openSettingsTab: () => void;
  tabStore: TabStore;
  openCodingPlanUpgrade: (
    target: { providerId: string },
    observation?: { signal: AbortSignal; onResult: (opened: boolean) => void },
  ) => boolean;
  upgradeProviderId: () => string | undefined;
  openRewards: (() => void | Promise<void>) | null;
  isDialogOpen: () => boolean;
  formatMessage: (descriptor: { id: string }) => string;
  user: { id: string } | null;
  requestLoginEntry: () => void;
  codingPlanSubscriptionService: ICodingPlanSubscriptionService;
  providerSettingsService: { refresh(reason: string): Promise<unknown> };
  refreshStartPlanEntitlement: () => Promise<void>;
}

function capabilityFailure(
  error: unknown,
  signal: AbortSignal,
  formatMessage: MarketingCampaignRuntime["formatMessage"],
  action: MarketingButtonAction["type"],
): MarketingExecuteResult {
  const timedOut = error instanceof Error && error.message === "marketing_capability_timeout";
  if (!signal.aborted) {
    logger.warn("[marketing-touch] capability failed", {
      action,
      reason: timedOut ? "timeout" : "unavailable",
    });
  }
  return {
    status: signal.aborted ? "cancelled" : timedOut ? "uncertain" : "failure",
    message: formatMessage({
      id: timedOut ? "marketingTouch.uncertain" : "marketingTouch.failed",
    }),
  };
}

export async function executeMarketingCampaignAction(
  action: MarketingButtonAction,
  signal: AbortSignal,
  setPhase: (phase: MarketingPhase) => void,
  runtime: MarketingCampaignRuntime,
): Promise<MarketingExecuteResult> {
  if (action.type === "close") return { status: "cancelled" };
  if (action.type === "navigate" || action.type === "copy_text") {
    try {
      signal.throwIfAborted();
      setPhase("submitting");
      if (action.type === "copy_text") {
        await raceMarketingCapability(
          navigator.clipboard.writeText(action.args.text),
          signal,
          10_000,
        );
        signal.throwIfAborted();
        if (!runtime.isDialogOpen()) {
          toast(runtime.formatMessage({ id: "manualClaimPlan.claim.share.copyTextSucceeded" }));
        }
      } else if (action.args.page === "rewards") {
        if (!runtime.openRewards) throw new Error("marketing_navigation_unavailable");
        await runtime.openRewards();
      } else {
        const navigationAbort = new AbortController();
        const abortNavigation = () => navigationAbort.abort();
        signal.addEventListener("abort", abortNavigation, { once: true });
        try {
          await requestMarketingNavigation(action.args, signal, () => {
            if (action.args.page === "upgrade") {
              if (!runtime.desktop) throw new Error("marketing_navigation_unavailable");
              const requestId = marketingNavigationStore.getState().request?.id;
              if (requestId === undefined) throw new Error("marketing_navigation_unavailable");
              if (
                !runtime.openCodingPlanUpgrade(
                  { providerId: runtime.upgradeProviderId() ?? "" },
                  {
                    signal: navigationAbort.signal,
                    onResult: (opened) =>
                      acknowledgeMarketingNavigation(
                        requestId,
                        opened ? undefined : new Error("marketing_upgrade_unavailable"),
                      ),
                  },
                )
              ) {
                throw new Error("marketing_upgrade_unavailable");
              }
              return;
            }
            if (action.args.page === "settings") {
              if (action.args.section) {
                setPendingSettingsSectionIntent(MARKETING_SETTINGS_SECTION[action.args.section], {
                  modelProviderId: action.args.provider_id,
                });
              }
              runtime.openSettingsTab();
              return;
            }
            if (action.args.page !== "plugin_marketplace") {
              throw new Error("marketing_navigation_unavailable");
            }
            const tabs = runtime.tabStore.getState();
            if (!tabs.activeWorkspacePath) throw new Error("marketing_navigation_unavailable");
            requestPluginStoreOpen(action.args.plugin_id);
            if (
              !tabs.activateTabByPath(tabs.activeWorkspacePath, {
                workspaceIdentity: tabs.activeWorkspaceIdentity ?? undefined,
              })
            ) {
              throw new Error("marketing_navigation_unavailable");
            }
          });
        } finally {
          signal.removeEventListener("abort", abortNavigation);
          navigationAbort.abort();
        }
      }
      return { status: "success" };
    } catch (error) {
      return capabilityFailure(error, signal, runtime.formatMessage, action.type);
    }
  }
  if (action.type === "open_url") {
    try {
      await runtime.platform.openExternal(action.args.url);
      return { status: "success" };
    } catch {
      return {
        status: "failure",
        message: runtime.formatMessage({ id: "marketingTouch.failed" }),
      };
    }
  }
  if (!runtime.user) {
    runtime.requestLoginEntry();
    return { status: "cancelled" };
  }
  let submitted = false;
  try {
    setPhase("verifying");
    const captchaConfig = await runtime.codingPlanSubscriptionService.getCaptchaConfig();
    signal.throwIfAborted();
    const captchaVerifyParam = await verifyManualClaimCaptcha(
      runtime.codingPlanSubscriptionService,
      signal,
    );
    signal.throwIfAborted();
    if (!captchaVerifyParam?.trim()) {
      return {
        status: "cancelled",
        message: runtime.formatMessage({ id: "manualClaimPlan.claim.failure.captcha" }),
      };
    }
    setPhase("submitting");
    submitted = true;
    const region = readCaptchaRegion(captchaConfig);
    const claimed = await runtime.codingPlanSubscriptionService.claimManualPlan({
      planId: action.args.plan_id,
      captchaVerifyParam,
      ...(region ? { captchaRegion: region } : {}),
    });
    signal.throwIfAborted();
    if (!claimed.success) {
      return {
        status: "failure",
        terminal: CLAIM_TERMINAL_CODES.has(claimed.code),
        message: claimed.message?.trim()
          ? claimed.message
          : runtime.formatMessage({ id: "manualClaimPlan.claim.failure.generic" }),
      };
    }
    void Promise.allSettled([
      runtime.refreshStartPlanEntitlement(),
      runtime.providerSettingsService.refresh("marketing-plan-claim"),
    ]).then((results) => {
      if (results.some((result) => result.status === "rejected")) {
        logger.warn("[marketing-touch] claim succeeded but entitlement refresh failed");
      }
    });
    return { status: "success" };
  } catch {
    if (signal.aborted) return { status: "cancelled" };
    return {
      status: submitted ? "uncertain" : "failure",
      message: runtime.formatMessage({
        id: submitted ? "marketingTouch.uncertain" : "marketingTouch.failed",
      }),
    };
  }
}

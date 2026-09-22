import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BUILTIN_MODEL_PROVIDER_IDS } from "@zcode/shared";

import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useUsageEntitlementWithService } from "@/hooks/useUsageEntitlement.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { buildStartPlanEntitlementOptions } from "@/lib/startPlanEntitlementOptions.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { useRewardsOpen } from "@/rewards/RewardsProvider.js";
import { useCodingPlanUpgradeDialog } from "@/settings/CodingPlanUpgradeDialogProvider.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { useTabStore, useTabStoreApi } from "@/store/TabStoreProvider.js";
import { useWorkspaceSidebarFooterUsageSummaryState } from "@/WorkspaceSidebarFooterUsageSummary.js";

import { executeMarketingCampaignAction } from "./marketingCampaignActions.js";
import {
  MarketingCampaignContext,
  MarketingCampaignRefreshContext,
} from "./marketingCampaignContext.js";
import { MarketingCampaignDialog } from "./MarketingCampaignDialog.js";
import { canOpenMarketingTouch } from "./marketingTouchGate.js";
import { cloudContentMediaPort, prepareMarketingDelivery } from "./prepareMarketingDelivery.js";
import {
  createMarketingTouchController,
  type MarketingTouchController,
} from "./marketingTouchController.js";
import {
  createMarketingTouchPoller,
  marketingPollIntervalMs,
  type MarketingTouchPoller,
} from "./marketingTouchPoller.js";
import { useMarketingTouchSessionRefresh } from "./useMarketingTouchSessionRefresh.js";

interface MarketingCampaignSession {
  controller: MarketingTouchController;
  poller: MarketingTouchPoller;
}

function MarketingCampaignSessionRefresh(props: {
  workspacePath: string;
  workspaceIdentity?: string;
  endpointKey?: string | null;
  rpcReady: boolean;
}) {
  useMarketingTouchSessionRefresh(props);
  return null;
}

export function MarketingCampaignProvider({
  children,
  desktop,
  workspacePath,
  workspaceIdentity,
  endpointKey,
  rpcReady,
}: {
  children: ReactNode;
  desktop: boolean;
  workspacePath: string;
  workspaceIdentity?: string;
  endpointKey?: string | null;
  rpcReady: boolean;
}) {
  const services = useServices();
  const platform = usePlatform();
  const tabStore = useTabStoreApi();
  const { openCodingPlanUpgrade } = useCodingPlanUpgradeDialog();
  const activeWorkspacePath = useTabStore((state) => state.activeWorkspacePath);
  const activeWorkspaceIdentity = useTabStore((state) => state.activeWorkspaceIdentity);
  const { upgradeTargetProviderId } = useWorkspaceSidebarFooterUsageSummaryState({
    enabled: true,
    workspacePath: activeWorkspacePath ?? undefined,
    workspaceIdentity: activeWorkspaceIdentity ?? undefined,
  });
  const upgradeProviderId = useRef(upgradeTargetProviderId);
  upgradeProviderId.current = upgradeTargetProviderId;
  const user = useZCodeStore((state) => state.user);
  const restoring = useZCodeStore((state) => state.isRestoringOAuthSession);
  const requestLoginEntry = useZCodeStore((state) => state.requestLoginEntry);
  const openRewards = useRewardsOpen();
  const openRewardsRef = useRef(openRewards);
  openRewardsRef.current = openRewards;
  const { intl, locale } = useZCodeIntl();
  const providerSettings = useProviderSettingsView();
  const providerView =
    providerSettings.state.status === "ready" ? providerSettings.state.view : null;
  const startPlan = useUsageEntitlementWithService(services.usageStatsService, {
    ...buildStartPlanEntitlementOptions(providerView, BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan),
    refreshOnMount: false,
    mountRefreshReason: "access",
  });
  const refreshStartPlan = useRef(startPlan.refresh);
  refreshStartPlan.current = startPlan.refresh;
  const runtimeRef = useRef({
    services,
    platform,
    tabStore,
    openCodingPlanUpgrade,
    intl,
    user,
    requestLoginEntry,
  });
  runtimeRef.current = {
    services,
    platform,
    tabStore,
    openCodingPlanUpgrade,
    intl,
    user,
    requestLoginEntry,
  };
  const [session, setSession] = useState<MarketingCampaignSession | null>(null);
  const sessionRef = useRef<MarketingCampaignSession | null>(null);
  const userId = user?.id ?? "anonymous";
  const marketing = services.marketingTouchService;

  const createSession = useCallback(() => {
    if (!marketing || restoring) return null;
    let poller: MarketingTouchPoller | undefined;
    const controller = createMarketingTouchController({
      query: () => marketing.query({ locale }),
      report: (action) => marketing.report(action),
      locale,
      canOpen: canOpenMarketingTouch,
      refresh: () => poller?.refresh(),
      prepare: (delivery) =>
        prepareMarketingDelivery({
          delivery,
          media: cloudContentMediaPort(runtimeRef.current.services.cloudContentService),
          locale,
          desktop,
        }),
      execute: (action, signal, setPhase) => {
        const latest = runtimeRef.current;
        return executeMarketingCampaignAction(action, signal, setPhase, {
          desktop,
          platform: latest.platform,
          openSettingsTab: () => latest.tabStore.getState().openSettingsTab(),
          tabStore: latest.tabStore,
          openCodingPlanUpgrade: latest.openCodingPlanUpgrade,
          upgradeProviderId: () => upgradeProviderId.current,
          openRewards: openRewardsRef.current,
          isDialogOpen: () => Boolean(sessionRef.current?.controller.store.getState().dialog),
          formatMessage: (descriptor) => latest.intl.formatMessage(descriptor),
          user: latest.user,
          requestLoginEntry: () => {
            latest.requestLoginEntry();
          },
          codingPlanSubscriptionService: latest.services.codingPlanSubscriptionService,
          providerSettingsService: latest.services.providerSettingsService,
          refreshStartPlanEntitlement: () =>
            refreshStartPlan.current({ force: true, silent: true, reason: "purchase" }),
        });
      },
    });
    poller = createMarketingTouchPoller({
      intervalMs: marketingPollIntervalMs(
        (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE,
      ),
      query: async () => {
        await controller.refresh();
        await controller.showPending();
      },
      visible: () => document.visibilityState !== "hidden",
    });
    return { controller, poller };
  }, [desktop, locale, marketing, restoring, userId]);

  useEffect(() => {
    const next = createSession();
    sessionRef.current = next;
    setSession(next);
    if (!next) return;
    const onVisibility = () => {
      next.poller.visibilityChanged();
      void next.controller.showPending();
    };
    const onOnline = () => next.poller.refresh();
    const observer = new MutationObserver(() => {
      void next.controller.showPending().catch(() => undefined);
    });
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    next.poller.refresh();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      next.poller.dispose();
      next.controller.dispose();
    };
  }, [createSession]);

  return (
    <MarketingCampaignContext.Provider value={session?.controller ?? null}>
      <MarketingCampaignRefreshContext.Provider value={session?.poller.refresh ?? null}>
        {children}
        <MarketingCampaignSessionRefresh
          workspacePath={workspacePath}
          workspaceIdentity={workspaceIdentity}
          endpointKey={endpointKey}
          rpcReady={rpcReady}
        />
      </MarketingCampaignRefreshContext.Provider>
      {session ? <MarketingCampaignDialog controller={session.controller} /> : null}
    </MarketingCampaignContext.Provider>
  );
}

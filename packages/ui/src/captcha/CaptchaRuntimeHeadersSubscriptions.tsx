import { useEffect, useMemo } from "react";

import { ServiceProvider, useServices } from "@/hooks/useServices.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { logger } from "@/logger.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab, type WorkspaceTabState } from "@/store/tabStore.js";

import {
  cancelProviderRuntimeHeadersRequest,
  handleProviderRuntimeHeadersRequest,
} from "./providerRuntimeHeadersCaptcha.js";

function workspaceKey(tab: WorkspaceTabState): string {
  return tab.workspaceIdentity?.trim() || tab.workspacePath;
}

function uniqueWorkspaceTabs(tabs: readonly WorkspaceTabState[]): WorkspaceTabState[] {
  const seen = new Map<string, WorkspaceTabState>();
  for (const tab of tabs) {
    const key = workspaceKey(tab);
    if (!seen.has(key)) seen.set(key, tab);
  }
  return [...seen.values()];
}

function CaptchaRuntimeHeadersSubscription({
  workspacePath,
  workspaceIdentity,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
}) {
  const { codingPlanSubscriptionService, providerSettingsService, zcodeAgentService } =
    useServices();
  useEffect(() => {
    const target = {
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
    };
    const cancelled = zcodeAgentService.onDynamicWorkspaceProviderRuntimeHeadersCancelled(target)((
      event,
    ) => {
      cancelProviderRuntimeHeadersRequest(event);
    });
    const requested = zcodeAgentService.onDynamicWorkspaceProviderRuntimeHeadersRequest(target)((
      request,
    ) => {
      void handleProviderRuntimeHeadersRequest({
        request,
        zcodeSessionService: zcodeAgentService,
        codingPlanSubscriptionService,
        providerSettingsService,
      }).catch((error: unknown) => {
        logger.warn("[v4-runtime-auth] provider runtime headers response failed", {
          error: error instanceof Error ? error.message : String(error),
          providerId: request.providerId,
          requestId: request.requestId,
          sessionId: request.sessionId,
        });
      });
    });
    return () => {
      requested.dispose();
      cancelled.dispose();
    };
  }, [
    codingPlanSubscriptionService,
    providerSettingsService,
    workspaceIdentity,
    workspacePath,
    zcodeAgentService,
  ]);
  return null;
}

function CaptchaWorkspaceSubscription({ tab }: { tab: WorkspaceTabState }) {
  const resolution = useWorkspaceServicesResolution(
    tab.workspacePath,
    tab.remoteSessionId,
    tab.workspaceIdentity,
    tab.remoteTarget,
  );
  if (!resolution.rpcReady) return null;
  return (
    <ServiceProvider services={resolution.services}>
      <CaptchaRuntimeHeadersSubscription
        workspacePath={tab.workspacePath}
        {...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {})}
      />
    </ServiceProvider>
  );
}

export function CaptchaRuntimeHeadersSubscriptions() {
  const tabs = useTabStore((state) => state.tabs);
  const workspaceTabs = useMemo(() => uniqueWorkspaceTabs(tabs.filter(isWorkspaceTab)), [tabs]);
  return (
    <>
      {workspaceTabs.map((tab) => (
        <CaptchaWorkspaceSubscription key={workspaceKey(tab)} tab={tab} />
      ))}
    </>
  );
}

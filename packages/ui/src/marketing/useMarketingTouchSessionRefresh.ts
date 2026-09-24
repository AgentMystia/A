import { useContext, useEffect } from "react";

import { useServices } from "@/hooks/useServices.js";
import { acquireSessionsIndex, releaseSessionsIndex } from "@/v4/sessionsIndexRegistry.js";

import { MarketingCampaignRefreshContext } from "./marketingCampaignContext.js";

/** 会话进入 completedSuccess 时补一次活动查询。索引仍属于 sessions index。 */
export function useMarketingTouchSessionRefresh(input: {
  workspacePath: string;
  workspaceIdentity?: string;
  endpointKey?: string | null;
  rpcReady: boolean;
}) {
  const refresh = useContext(MarketingCampaignRefreshContext);
  const { zcodeAgentService } = useServices();
  const { workspacePath, workspaceIdentity, endpointKey, rpcReady } = input;
  useEffect(() => {
    if (!refresh || !rpcReady || !workspacePath) return;
    const identity = workspaceIdentity?.trim();
    const scope = {
      workspaceKey: identity || workspacePath,
      workspacePath,
      ...(identity ? { workspaceIdentity: identity } : {}),
      ...(endpointKey ? { endpointKey } : {}),
    };
    const store = acquireSessionsIndex(scope, zcodeAgentService);
    let phases: Map<string, string> | null = null;
    const sync = () => {
      if (store.getStatus() !== "live") {
        phases = null;
        return;
      }
      const sessions = store.getSessions();
      const completed = sessions.some((session) => {
        const previous = phases?.get(session.sessionId);
        return (
          previous !== undefined &&
          previous !== "completedSuccess" &&
          session.phase === "completedSuccess"
        );
      });
      phases = new Map(sessions.map((session) => [session.sessionId, session.phase]));
      if (completed) refresh();
    };
    const unsubscribe = store.subscribe(sync);
    sync();
    return () => {
      unsubscribe();
      releaseSessionsIndex(scope, store);
    };
  }, [endpointKey, refresh, rpcReady, workspaceIdentity, workspacePath, zcodeAgentService]);
}

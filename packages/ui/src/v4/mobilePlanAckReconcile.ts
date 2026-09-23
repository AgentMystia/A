import { logger } from "@/logger.js";

export const MOBILE_PLAN_ACK_RECONCILE_DELAY_MS = 500;

interface MobilePlanAckLease {
  store: {
    getState(): {
      snapshot: {
        pendingInteractions: readonly { interactionId: string }[];
      } | null;
    };
    recoverFromStaleAuthority(): void;
  };
}

/**
 * 手机远控的 Plan ACK 与 pending 清场是两条异步路径。
 * 同一 interaction 只排一次检查；500ms 后仍留在权威快照里时，复用 lease store 的恢复。
 */
export function scheduleMobilePlanAckReconcile(params: {
  interactionId: string;
  timers: Map<string, ReturnType<typeof setTimeout>>;
  compactForRemoteControl: boolean;
  lease: MobilePlanAckLease | null;
  sessionId: string | null;
  workspaceIdentity: string | undefined;
  workspacePath: string;
}): void {
  if (!params.compactForRemoteControl || !params.lease) return;
  const timers = params.timers;
  if (timers.has(params.interactionId)) return;
  const lease = params.lease;
  const interactionId = params.interactionId;
  const timer = setTimeout(() => {
    timers.delete(interactionId);
    if (
      lease.store
        .getState()
        .snapshot?.pendingInteractions.some((item) => item.interactionId === interactionId)
    ) {
      logger.warn("[v4-pane] 手机 Plan ACK 后 pending 未收口，触发权威恢复", {
        interactionId,
        sessionId: params.sessionId,
        workspaceKey: params.workspaceIdentity?.trim() || params.workspacePath,
      });
      lease.store.recoverFromStaleAuthority();
    }
  }, MOBILE_PLAN_ACK_RECONCILE_DELAY_MS);
  timers.set(interactionId, timer);
}

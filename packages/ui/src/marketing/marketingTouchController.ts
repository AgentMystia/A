import type {
  MarketingDelivery,
  MarketingTouchLocale,
  MarketingTouchQueryResult,
} from "@zcode/shared";
import { createStore, type StoreApi } from "zustand/vanilla";

import { logger } from "@/logger.js";

import type { CloudDialogHero } from "./cloudDialogModel.js";
import type { MarketingButtonAction } from "./marketingNavigation.js";

export type MarketingPhase = "idle" | "verifying" | "submitting" | "preparing";

export interface MarketingPreparedDelivery {
  delivery: MarketingDelivery;
  image?: string;
  darkImage?: string;
  bannerHero?: CloudDialogHero;
  hero: CloudDialogHero | null;
  success?: Promise<{ hero: CloudDialogHero | null } | undefined>;
  release: () => Promise<void>;
  scope: string;
}

export interface MarketingDialogEntry extends MarketingPreparedDelivery {
  result: boolean;
}

export interface MarketingTouchControllerState {
  banner: MarketingPreparedDelivery | null;
  dialog: MarketingDialogEntry | null;
  pending: boolean;
  phase: MarketingPhase;
  error: string | null;
  errorAction: MarketingButtonAction["type"] | null;
}

export interface MarketingExecuteResult {
  status: "success" | "cancelled" | "uncertain" | "failure";
  terminal?: boolean;
  message?: string;
}

export interface MarketingTouchControllerDeps {
  query: () => Promise<MarketingTouchQueryResult>;
  report: (action: {
    scope: string;
    campaignId: string;
    actionType: "confirm" | "cancel";
    locale: MarketingTouchLocale;
  }) => Promise<void>;
  locale: MarketingTouchLocale;
  canOpen: () => boolean;
  refresh: () => void;
  prepare: (delivery: MarketingDelivery) => Promise<Omit<MarketingPreparedDelivery, "scope">>;
  execute: (
    action: MarketingButtonAction,
    signal: AbortSignal,
    setPhase: (phase: MarketingPhase) => void,
  ) => Promise<MarketingExecuteResult>;
}

export interface MarketingTouchController {
  store: StoreApi<MarketingTouchControllerState>;
  refresh: () => Promise<void>;
  showPending: () => Promise<void>;
  clickBanner: () => Promise<void>;
  closeBanner: () => Promise<void>;
  closeDialog: () => Promise<void>;
  dialogAction: (action: MarketingButtonAction) => Promise<MarketingExecuteResult | undefined>;
  clearError: () => void;
  dispose: () => void;
}

function deliveryKey(delivery: MarketingDelivery): string {
  return `${delivery.resource_position}:${delivery.campaign_id}`;
}

/**
 * 发布包把下一次 banner 放在动作进行中的旁路变量里。
 * undefined 表示没有替换；null 表示动作结束后要清掉当前 banner。
 * 世代号让过期的 query 不能写回已关闭的投放。
 */
export function createMarketingTouchController(
  deps: MarketingTouchControllerDeps,
): MarketingTouchController {
  const store = createStore<MarketingTouchControllerState>(() => ({
    banner: null,
    dialog: null,
    pending: false,
    phase: "idle",
    error: null,
    errorAction: null,
  }));
  let disposed = false;
  let generation = 0;
  let scope = "";
  let queryFailed = false;
  let lastSuccessAt = 0;
  let queuedBanner: MarketingPreparedDelivery | null | undefined;
  let pendingPopup: MarketingPreparedDelivery | null = null;
  let successDialog: MarketingPreparedDelivery | null = null;
  const abort = new AbortController();

  const releasePrepared = (entry: { release?: () => Promise<void> } | null | undefined) => {
    const release = entry?.release;
    if (!release) return;
    void release().catch(() => {
      logger.warn("[marketing-touch] resource release failed");
    });
  };
  const report = (entry: MarketingPreparedDelivery, actionType: "confirm" | "cancel") => {
    if (disposed) return;
    deps
      .report({
        scope: entry.scope,
        campaignId: entry.delivery.campaign_id,
        actionType,
        locale: deps.locale,
      })
      .catch(() => {
        logger.warn("[marketing-touch] action report failed", {
          campaignId: entry.delivery.campaign_id,
          actionType,
        });
      });
  };
  function invalidateQueuedBanner() {
    generation += 1;
    releasePrepared(queuedBanner);
    queuedBanner = undefined;
  }

  async function refresh() {
    const token = ++generation;
    try {
      const result = await deps.query();
      if (disposed || token !== generation) return;
      if (scope && scope !== result.scope) {
        releasePrepared(pendingPopup);
        pendingPopup = null;
      }
      scope = result.scope;
      queryFailed = false;
      lastSuccessAt = Date.now();
      const current = store.getState();
      const banner = result.deliveries.find((item) => item.resource_position === "banner");
      const popup = result.deliveries.find(
        (item) =>
          item.resource_position === "popup" &&
          (!current.dialog ||
            current.dialog.result ||
            deliveryKey(current.dialog.delivery) !== deliveryKey(item)),
      );
      if (!popup || JSON.stringify(pendingPopup?.delivery) !== JSON.stringify(popup)) {
        releasePrepared(pendingPopup);
        pendingPopup = null;
      }
      if (!banner) {
        if (current.pending) {
          releasePrepared(queuedBanner);
          queuedBanner = null;
        } else {
          releasePrepared(current.banner);
          store.setState({ banner: null });
        }
      } else if (
        current.banner &&
        !current.pending &&
        JSON.stringify(current.banner.delivery) !== JSON.stringify(banner)
      ) {
        releasePrepared(current.banner);
        store.setState({ banner: null });
      }
      await Promise.all(
        result.deliveries.map(async (delivery) => {
          if (delivery !== banner && delivery !== popup) return;
          if (
            delivery === banner &&
            JSON.stringify(current.banner?.delivery) === JSON.stringify(delivery)
          ) {
            if (!current.pending && current.banner) {
              store.setState({ banner: { ...current.banner, scope: result.scope } });
            }
            return;
          }
          if ((delivery === popup && pendingPopup) || disposed || token !== generation) return;
          let prepared: Omit<MarketingPreparedDelivery, "scope">;
          try {
            prepared = await deps.prepare(delivery);
          } catch {
            logger.warn("[marketing-touch] banner resource rejected", {
              campaignId: delivery.campaign_id,
            });
            return;
          }
          if (disposed || token !== generation) {
            releasePrepared(prepared);
            return;
          }
          const scoped = { ...prepared, scope: result.scope };
          if (delivery.resource_position === "banner") {
            if (store.getState().pending) {
              releasePrepared(queuedBanner);
              queuedBanner = scoped;
            } else {
              releasePrepared(store.getState().banner);
              store.setState({ banner: scoped });
            }
          } else {
            releasePrepared(pendingPopup);
            pendingPopup = scoped;
          }
        }),
      );
    } catch (error) {
      if (!disposed && token === generation) {
        if (!queryFailed) logger.warn("[marketing-touch] query failed; keeping recent content");
        queryFailed = true;
        if (Date.now() - lastSuccessAt > 600_000 && !store.getState().pending) {
          releasePrepared(store.getState().banner);
          store.setState({ banner: null });
        }
      }
      throw error;
    }
  }

  async function showPending() {
    const current = store.getState();
    if (
      disposed ||
      current.pending ||
      current.dialog ||
      (current.errorAction === "claim_zcode_plan" && current.error) ||
      !deps.canOpen()
    ) {
      return;
    }
    if (successDialog) {
      const next = successDialog;
      successDialog = null;
      store.setState({ dialog: { ...next, result: true } });
      return;
    }
    if (!pendingPopup) return;
    const next = pendingPopup;
    pendingPopup = null;
    store.setState({ dialog: { ...next, result: false } });
  }

  async function runAction(
    target: MarketingPreparedDelivery,
    action: MarketingButtonAction,
  ): Promise<MarketingExecuteResult | undefined> {
    if (disposed || store.getState().pending) return;
    store.setState({ pending: true, phase: "verifying", error: null, errorAction: null });
    let terminal = false;
    let succeeded = false;
    try {
      const result = await deps.execute(action, abort.signal, (phase) => {
        if (!disposed) store.setState({ phase });
      });
      if (disposed) return;
      if (result.status !== "success") {
        if (
          (action.type === "claim_zcode_plan" || action.type === "open_url") &&
          (result.terminal || result.status === "uncertain")
        ) {
          terminal = true;
          invalidateQueuedBanner();
        }
        store.setState({ error: result.message ?? null, errorAction: action.type });
        return result;
      }
      terminal = action.type !== "copy_text";
      succeeded = true;
      invalidateQueuedBanner();
      report(target, "confirm");
      if (action.type === "copy_text") return result;
      if (
        action.type !== "navigate" &&
        target.delivery.resource_position === "banner" &&
        target.delivery.banner.success_popup
      ) {
        store.setState({ phase: "preparing" });
        const success = await target.success;
        if (disposed) return;
        successDialog = { ...target, hero: success?.hero ?? target.hero };
      } else if (store.getState().dialog === target) {
        store.setState({ dialog: null });
        releasePrepared(target);
      }
      return result;
    } finally {
      if (!disposed) {
        const current = store.getState();
        const nextBanner =
          queuedBanner === undefined
            ? terminal && current.banner?.release === target.release
              ? null
              : current.banner
            : queuedBanner;
        queuedBanner = undefined;
        if (
          current.banner &&
          current.banner.release !== nextBanner?.release &&
          current.banner.release !== current.dialog?.release &&
          current.banner.release !== successDialog?.release
        ) {
          releasePrepared(current.banner);
        }
        store.setState({ pending: false, phase: "idle", banner: nextBanner });
        await showPending();
        if (succeeded && action.type !== "copy_text" && action.type !== "navigate" && !disposed) {
          deps.refresh();
        }
      }
    }
  }

  return {
    store,
    refresh,
    showPending,
    async clickBanner() {
      const banner = store.getState().banner;
      if (!banner || banner.delivery.resource_position !== "banner" || store.getState().dialog) {
        return;
      }
      const action = banner.delivery.banner.buttons.find(
        (button) => button.action.type !== "close",
      )?.action;
      if (action) await runAction(banner, action);
    },
    async closeBanner() {
      const banner = store.getState().banner;
      if (!banner || store.getState().pending) return;
      invalidateQueuedBanner();
      store.setState({ banner: null });
      report(banner, "cancel");
      releasePrepared(banner);
    },
    async closeDialog() {
      const dialog = store.getState().dialog;
      if (!dialog || store.getState().pending) return;
      invalidateQueuedBanner();
      store.setState({ dialog: null });
      if (!dialog.result) report(dialog, "cancel");
      releasePrepared(dialog);
    },
    async dialogAction(action) {
      const dialog = store.getState().dialog;
      if (dialog) return runAction(dialog, action);
      return undefined;
    },
    clearError() {
      store.setState({ error: null, errorAction: null });
    },
    dispose() {
      disposed = true;
      generation += 1;
      abort.abort();
      releasePrepared(store.getState().banner);
      releasePrepared(store.getState().dialog);
      releasePrepared(pendingPopup);
      releasePrepared(successDialog);
      releasePrepared(queuedBanner);
      store.setState({ banner: null, dialog: null, pending: false });
    },
  };
}

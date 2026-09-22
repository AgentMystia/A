import { useEffect } from "react";
import { useStore } from "zustand";

import { toast } from "@/components/ui/toast.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

import { buildCloudDialogPayload } from "./cloudDialogModel.js";
import { CloudContentDialog } from "./CloudContentDialog.js";
import { MarketingFailureDialog } from "./MarketingFailureDialog.js";
import { marketingNavigationStore } from "./marketingNavigation.js";
import type { MarketingTouchController } from "./marketingTouchController.js";

export function MarketingCampaignDialog({ controller }: { controller: MarketingTouchController }) {
  const state = useStore(controller.store);
  const upgradeNavigation = useStore(
    marketingNavigationStore,
    (requestState) => requestState.request?.target.page === "upgrade",
  );
  const { locale, intl } = useZCodeIntl();
  const claimError = state.errorAction === "claim_zcode_plan" ? state.error : null;
  useEffect(() => {
    if (state.error && !claimError) {
      toast(state.error);
      controller.clearError();
    }
  }, [claimError, controller, state.error]);
  const dialog = state.dialog;
  const popup = dialog
    ? dialog.delivery.resource_position === "popup"
      ? dialog.delivery.popup
      : dialog.delivery.banner.success_popup
    : null;
  const payload =
    dialog && popup
      ? buildCloudDialogPayload({
          campaignId: dialog.delivery.campaign_id,
          locale,
          popup,
          hero: dialog.hero,
          modelSettingsLabel: intl.formatMessage({
            id: "manualClaimPlan.claim.dialog.modelSettings",
          }),
        })
      : null;
  return (
    <>
      {claimError ? (
        <MarketingFailureDialog
          message={claimError}
          title={intl.formatMessage({ id: "manualClaimPlan.claim.failure.title" })}
          acknowledge={intl.formatMessage({ id: "manualClaimPlan.claim.dialog.acknowledge" })}
          onClose={() => controller.clearError()}
        />
      ) : null}
      {payload && popup ? (
        <CloudContentDialog
          payload={payload}
          open={!upgradeNavigation && !claimError}
          actionPending={state.pending}
          onClose={() => {
            void controller.closeDialog();
          }}
          labels={{
            actionFailed: intl.formatMessage({ id: "marketingTouch.failed" }),
            copySucceeded: intl.formatMessage({
              id: "manualClaimPlan.claim.share.copyTextSucceeded",
            }),
          }}
          handlers={{
            open_external: async (action) => {
              await controller.dialogAction({ type: "open_url", args: { url: action.url } });
            },
            claim_plan: async (action) => {
              await controller.dialogAction({
                type: "claim_zcode_plan",
                args: { plan_id: action.planId },
              });
            },
            copy_text: async (action) => {
              const result = await controller.dialogAction({
                type: "copy_text",
                args: { text: action.text },
              });
              if (result?.status !== "success") throw new Error("marketing_copy_failed");
            },
            navigate: async (_action, actionId) => {
              const button = popup.buttons.find((_button, index) => `button-${index}` === actionId);
              if (button?.action.type !== "navigate") {
                throw new Error("marketing_navigation_invalid");
              }
              const result = await controller.dialogAction(button.action);
              if (result?.status !== "success") throw new Error("marketing_navigation_failed");
            },
          }}
        />
      ) : null}
    </>
  );
}

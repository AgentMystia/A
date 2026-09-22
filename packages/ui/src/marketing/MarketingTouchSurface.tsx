import type { ComponentProps } from "react";

import { CloudContentDialog } from "./CloudContentDialog.js";
import { MarketingBanner } from "./MarketingBanner.js";

export interface MarketingTouchSurfaceProps {
  banner?: ComponentProps<typeof MarketingBanner> | null;
  dialog?: ComponentProps<typeof CloudContentDialog> | null;
}

/** 活动控制器尚未还原。没有 payload 时不打开弹窗，组件仍留在 renderer 图里以加载 lottie。 */
export function MarketingTouchSurface({
  banner = null,
  dialog = null,
}: MarketingTouchSurfaceProps) {
  return (
    <>
      {banner ? <MarketingBanner {...banner} /> : null}
      <CloudContentDialog
        payload={dialog?.payload ?? null}
        open={dialog?.open ?? false}
        onClose={dialog?.onClose ?? (() => undefined)}
        handlers={dialog?.handlers ?? {}}
        labels={dialog?.labels ?? { actionFailed: "", copySucceeded: "" }}
        actionPending={dialog?.actionPending}
        returnFocusRef={dialog?.returnFocusRef}
      />
    </>
  );
}

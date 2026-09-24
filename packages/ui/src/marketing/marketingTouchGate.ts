const MARKETING_TOUCH_BLOCKERS =
  '[role="dialog"], [role="alertdialog"], [data-testid="coding-plan-upgrade-surface"], .aliyunCaptcha-mask, .aliyunCaptcha-window';

export function canOpenMarketingTouch(): boolean {
  return document.visibilityState !== "hidden" && !document.querySelector(MARKETING_TOUCH_BLOCKERS);
}

export const WEB_REMOTE_NAVIGATION_COLLAPSE_ONCE_KEY =
  "zcode:web-remote-control:collapse-navigation-once";

const NAVIGATION_VIEWPORT_RATIO = 0.5;
const NAVIGATION_MAX_HEIGHT_PX = 352;
const NAVIGATION_COLLAPSE_THRESHOLD_PX = 24;
const NAVIGATION_CHROME_OFFSET_PX = 48;
const NAVIGATION_RESERVED_BELOW_PX = 168;
export const WEB_REMOTE_NAVIGATION_DRAG_SLOP_PX = 4;
const FALLBACK_VIEWPORT_HEIGHT_PX = 800;

export interface WebRemoteNavigationHeight {
  heightPx: number;
  isCollapsed: boolean;
}

export interface WebRemoteNavigationTaskOpen {
  crossWorkspace: boolean;
}

export function readWebRemoteViewportHeightPx(): number {
  if (typeof window === "undefined") {
    return FALLBACK_VIEWPORT_HEIGHT_PX;
  }
  return window.innerHeight || FALLBACK_VIEWPORT_HEIGHT_PX;
}

export function expandedWebRemoteNavigationHeightPx(viewportHeight: number): number {
  return Math.round(
    Math.max(
      0,
      Math.min(
        viewportHeight * NAVIGATION_VIEWPORT_RATIO - NAVIGATION_CHROME_OFFSET_PX,
        NAVIGATION_MAX_HEIGHT_PX,
      ),
    ),
  );
}

export function maxWebRemoteNavigationHeightPx(viewportHeight: number): number {
  return Math.max(
    0,
    Math.round(viewportHeight - NAVIGATION_CHROME_OFFSET_PX - NAVIGATION_RESERVED_BELOW_PX),
  );
}

export function resolveWebRemoteNavigationHeight(input: {
  heightPx: number;
  viewportHeight: number;
}): WebRemoteNavigationHeight {
  const maxHeightPx = maxWebRemoteNavigationHeightPx(input.viewportHeight);
  const heightPx = Math.max(0, Math.min(Math.round(input.heightPx), maxHeightPx));
  if (heightPx <= NAVIGATION_COLLAPSE_THRESHOLD_PX) {
    return { heightPx: 0, isCollapsed: true };
  }
  return { heightPx, isCollapsed: false };
}

export function toggleWebRemoteNavigationHeight(input: {
  currentHeightPx: number;
  isCollapsed: boolean;
  viewportHeight: number;
}): WebRemoteNavigationHeight {
  if (!input.isCollapsed && input.currentHeightPx > NAVIGATION_COLLAPSE_THRESHOLD_PX) {
    return { heightPx: 0, isCollapsed: true };
  }
  return resolveWebRemoteNavigationHeight({
    heightPx: expandedWebRemoteNavigationHeightPx(input.viewportHeight),
    viewportHeight: input.viewportHeight,
  });
}

/** 非远控、非手机或未收起时侧栏内容可见。 */
export function isWebRemoteNavigationPanelShown(input: {
  isCollapsed: boolean;
  isMobileViewport: boolean;
  isWebRemoteControlShell: boolean;
}): boolean {
  return !input.isWebRemoteControlShell || !input.isMobileViewport || !input.isCollapsed;
}

export function webRemoteNavigationSidebarPanelClass(isPanelShown: boolean): string {
  return isPanelShown
    ? "max-md:!h-[var(--web-remote-navigation-height)] max-md:!min-h-0 max-md:!w-full max-md:!max-w-none max-md:!flex-none max-md:!basis-auto max-md:border-b max-md:border-border max-md:bg-sidebar"
    : "max-md:!h-0 max-md:!min-h-0 max-md:!w-full max-md:!max-w-none max-md:!flex-none max-md:!basis-0 max-md:!border-b-0";
}

function readSessionStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) {
    return storage;
  }
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function consumeWebRemoteNavigationCollapseOnce(storage?: Storage | null): boolean {
  const session = readSessionStorage(storage);
  if (!session) {
    return false;
  }
  try {
    if (session.getItem(WEB_REMOTE_NAVIGATION_COLLAPSE_ONCE_KEY) === "1") {
      session.removeItem(WEB_REMOTE_NAVIGATION_COLLAPSE_ONCE_KEY);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function markWebRemoteNavigationCollapseOnce(storage?: Storage | null): void {
  const session = readSessionStorage(storage);
  if (!session) {
    return;
  }
  try {
    session.setItem(WEB_REMOTE_NAVIGATION_COLLAPSE_ONCE_KEY, "1");
  } catch {
    // sessionStorage 在隐私模式可能抛错，收起标志丢失不影响当前壳。
  }
}

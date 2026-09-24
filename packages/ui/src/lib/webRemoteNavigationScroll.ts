export interface WebRemoteNavigationScrollChrome {
  scrollDataAttribute: "true" | undefined;
  scrollClassName: string | undefined;
  contentClassName: string | undefined;
  dragSpacerClassName: string | undefined;
}

const INACTIVE_WEB_REMOTE_NAVIGATION_SCROLL: WebRemoteNavigationScrollChrome = {
  scrollDataAttribute: undefined,
  scrollClassName: undefined,
  contentClassName: undefined,
  dragSpacerClassName: undefined,
};

const ACTIVE_WEB_REMOTE_NAVIGATION_SCROLL: WebRemoteNavigationScrollChrome = {
  scrollDataAttribute: "true",
  scrollClassName: "max-md:overflow-y-auto",
  contentClassName: "max-md:pt-11",
  dragSpacerClassName: "max-md:hidden",
};

export function resolveWebRemoteNavigationScrollChrome(
  active: boolean,
): WebRemoteNavigationScrollChrome {
  return active ? ACTIVE_WEB_REMOTE_NAVIGATION_SCROLL : INACTIVE_WEB_REMOTE_NAVIGATION_SCROLL;
}

import { useEffect, useState } from "react";

const MOBILE_WEB_REMOTE_QUERY = "(max-width: 767px)";

function readMobileWebRemoteViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_WEB_REMOTE_QUERY).matches
  );
}

/** 只有远控壳启用时才订阅变化；初始值与发布包一样当场读 matchMedia。 */
export function useMobileWebRemoteViewport(enabled: boolean): boolean {
  const [matches, setMatches] = useState(readMobileWebRemoteViewport);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia(MOBILE_WEB_REMOTE_QUERY);
    const update = () => setMatches(media.matches);
    update();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, [enabled]);

  return matches;
}

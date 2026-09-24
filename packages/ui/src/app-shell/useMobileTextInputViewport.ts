import { useEffect, useState } from "react";

/** 发布包 styles 里的粗指针窄屏：软键盘会盖住输入，和单纯 max-width 不是同一条查询。 */
export const MOBILE_TEXT_INPUT_VIEWPORT_QUERY =
  "(max-width: 767px) and (hover: none) and (pointer: coarse)";

function readMobileTextInputViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_TEXT_INPUT_VIEWPORT_QUERY).matches
  );
}

function subscribeMobileTextInputViewport(onChange: (matches: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    onChange(false);
    return () => {};
  }
  const media = window.matchMedia(MOBILE_TEXT_INPUT_VIEWPORT_QUERY);
  const update = () => onChange(media.matches);
  update();
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }
  media.addListener(update);
  return () => media.removeListener(update);
}

export function useMobileTextInputViewport(): boolean {
  const [matches, setMatches] = useState(readMobileTextInputViewport);

  useEffect(() => subscribeMobileTextInputViewport(setMatches), []);

  return matches;
}

import { useSyncExternalStore } from "react";

function readCloudDialogMotionSnapshot(): string {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  return `${document.documentElement.classList.contains("dark")}:${reduced}:${document.visibilityState !== "hidden"}`;
}

function subscribeCloudDialogMotion(onStoreChange: () => void): () => void {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  media?.addEventListener("change", onStoreChange);
  document.addEventListener("visibilitychange", onStoreChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener("change", onStoreChange);
    document.removeEventListener("visibilitychange", onStoreChange);
  };
}

export function useCloudDialogMotion() {
  const [dark = false, reduced = false, visible = true] = useSyncExternalStore(
    subscribeCloudDialogMotion,
    readCloudDialogMotionSnapshot,
    () => "false:false:true",
  )
    .split(":")
    .map((part) => part === "true");
  return { dark, reduced, visible, animate: visible && !reduced };
}

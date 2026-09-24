import { useLayoutEffect, useRef } from "react";

const COMPOSER_COLLAPSE_PRIORITIES = ["0", "1", "2", "3"] as const;

/** 仅拥有 DOM 布局投影；权限、Plan 和 CUA 业务状态仍由原有 hooks 管理。 */
export function fitComposerToolbar(root: HTMLElement) {
  const leading = root.querySelector<HTMLElement>("[data-composer-leading-actions]");
  const content = root.querySelector<HTMLElement>("[data-composer-leading-content]");
  if (!leading || !content) return;
  const controls = root.querySelectorAll<HTMLElement>("[data-composer-collapse-priority]");
  delete root.dataset.composerModelIcon;
  delete root.dataset.composerProviderCompact;
  for (const control of controls) delete control.dataset.composerCompact;
  const trailing = root.querySelector<HTMLElement>("[data-composer-trailing-actions]");
  const gap = Number.parseFloat(getComputedStyle(root).columnGap) || 12;
  // 发布包用同一溢出公式决定每一档，思考档最后收成 icon，不再写模型最大宽度。
  const overflow = () =>
    Math.max(
      0,
      content.getBoundingClientRect().width - leading.getBoundingClientRect().width,
      trailing
        ? content.getBoundingClientRect().width +
            trailing.getBoundingClientRect().width +
            gap -
            root.getBoundingClientRect().width
        : 0,
    );
  for (const priority of COMPOSER_COLLAPSE_PRIORITIES) {
    if (overflow() <= 0) return;
    for (const control of controls) {
      if (control.dataset.composerCollapsePriority === priority) {
        control.dataset.composerCompact = "true";
      }
    }
  }
  if (overflow() <= 0) return;
  if (root.querySelector(".composer-provider-prefix")) {
    root.dataset.composerProviderCompact = "true";
  }
  if (overflow() <= 0) return;
  const thought = root.querySelector<HTMLElement>("[data-composer-thought-control]");
  if (thought) thought.dataset.composerCompact = "icon";
  if (overflow() > 0) root.dataset.composerModelIcon = "true";
}

export function useComposerToolbarFit() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const update = () => {
      if (!root.parentElement || root.getBoundingClientRect().width <= 0) return;
      // 在不可见副本上尝试展开，避免真实按钮测量时来回移动、丢失 hover 或关闭 Tooltip。
      const probe = root.cloneNode(true) as HTMLElement;
      probe.setAttribute("aria-hidden", "true");
      probe.inert = true;
      Object.assign(probe.style, {
        position: "absolute",
        visibility: "hidden",
        pointerEvents: "none",
        width: `${root.getBoundingClientRect().width}px`,
        left: "0",
        top: "0",
      });
      root.parentElement.append(probe);
      try {
        fitComposerToolbar(probe);
        for (const key of ["composerModelIcon", "composerProviderCompact"]) {
          if (probe.dataset[key]) root.dataset[key] = probe.dataset[key];
          else delete root.dataset[key];
        }
        const live = root.querySelectorAll<HTMLElement>("[data-composer-collapse-priority]");
        const measured = probe.querySelectorAll<HTMLElement>("[data-composer-collapse-priority]");
        live.forEach((control, index) => {
          const compact = measured[index]?.dataset.composerCompact;
          if (compact) control.dataset.composerCompact = compact;
          else delete control.dataset.composerCompact;
        });
      } finally {
        probe.remove();
      }
    };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    const observe = () => {
      resize?.disconnect();
      resize?.observe(root);
      for (const element of root.querySelectorAll<HTMLElement>(
        "[data-composer-leading-actions], [data-composer-leading-content], [data-composer-trailing-actions]",
      ))
        resize?.observe(element);
      update();
    };
    // 不观察布局属性自身，防止写 data-composer-compact 引起递归测量。
    const mutations = new MutationObserver(observe);
    mutations.observe(root, { childList: true, subtree: true, characterData: true });
    observe();
    return () => {
      resize?.disconnect();
      mutations.disconnect();
    };
  }, []);
  return ref;
}

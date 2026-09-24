import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { logger } from "@/logger.js";
import {
  WEB_REMOTE_NAVIGATION_DRAG_SLOP_PX,
  readWebRemoteViewportHeightPx,
  expandedWebRemoteNavigationHeightPx,
  isWebRemoteNavigationPanelShown,
  markWebRemoteNavigationCollapseOnce,
  resolveWebRemoteNavigationHeight,
  toggleWebRemoteNavigationHeight,
  consumeWebRemoteNavigationCollapseOnce,
  type WebRemoteNavigationHeight,
  type WebRemoteNavigationTaskOpen,
} from "@/web-remote/navigation/webRemoteControlNavigation.js";

interface NavigationDragSession {
  pointerId: number;
  startHeightPx: number;
  startY: number;
  didDrag: boolean;
}

export function useWebRemoteControlNavigation(enabled: boolean, isMobileViewport: boolean) {
  const [isCollapsed, setIsCollapsed] = useState(() =>
    enabled ? consumeWebRemoteNavigationCollapseOnce() : false,
  );
  const [heightPx, setHeightPx] = useState(() => {
    const viewportHeight = readWebRemoteViewportHeightPx();
    return resolveWebRemoteNavigationHeight({
      heightPx: expandedWebRemoteNavigationHeightPx(viewportHeight),
      viewportHeight,
    }).heightPx;
  });
  const [isDragging, setIsDragging] = useState(false);
  const heightRef = useRef(heightPx);
  const collapsedRef = useRef(isCollapsed);
  const dragRef = useRef<NavigationDragSession | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    heightRef.current = heightPx;
    collapsedRef.current = isCollapsed;
  }, [heightPx, isCollapsed]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }
    const onResize = () => {
      if (collapsedRef.current) {
        return;
      }
      const viewportHeight = readWebRemoteViewportHeightPx();
      setHeightPx(
        (current) =>
          resolveWebRemoteNavigationHeight({ heightPx: current, viewportHeight }).heightPx,
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [enabled]);

  const applyHeight = useCallback((next: WebRemoteNavigationHeight) => {
    heightRef.current = next.heightPx;
    collapsedRef.current = next.isCollapsed;
    setHeightPx(next.heightPx);
    setIsCollapsed(next.isCollapsed);
  }, []);

  const quickToggle = useCallback(() => {
    const next = toggleWebRemoteNavigationHeight({
      currentHeightPx: heightRef.current,
      isCollapsed: collapsedRef.current,
      viewportHeight: readWebRemoteViewportHeightPx(),
    });
    logger.debug("[WorkspaceShellLayout] Web 远控导航快速切换", next);
    applyHeight(next);
  }, [applyHeight]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!enabled || !isMobileViewport || (event.pointerType === "mouse" && event.button !== 0)) {
        return;
      }
      const startHeightPx = collapsedRef.current ? 0 : heightRef.current;
      dragRef.current = {
        pointerId: event.pointerId,
        startHeightPx,
        startY: event.clientY,
        didDrag: false,
      };
      suppressClickRef.current = true;
      setIsDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      logger.debug("[WorkspaceShellLayout] Web 远控导航拖拽开始", { startHeightPx });
    },
    [enabled, isMobileViewport],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const deltaPx = event.clientY - drag.startY;
      if (!drag.didDrag && Math.abs(deltaPx) < WEB_REMOTE_NAVIGATION_DRAG_SLOP_PX) {
        return;
      }
      event.preventDefault();
      drag.didDrag = true;
      applyHeight(
        resolveWebRemoteNavigationHeight({
          heightPx: drag.startHeightPx + deltaPx,
          viewportHeight: readWebRemoteViewportHeightPx(),
        }),
      );
    },
    [applyHeight],
  );

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      dragRef.current = null;
      setIsDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (cancelled) {
        suppressClickRef.current = false;
        return;
      }
      if (!drag.didDrag) {
        quickToggle();
        return;
      }
      const next = resolveWebRemoteNavigationHeight({
        heightPx: drag.startHeightPx + event.clientY - drag.startY,
        viewportHeight: readWebRemoteViewportHeightPx(),
      });
      logger.debug("[WorkspaceShellLayout] Web 远控导航拖拽结束", next);
      applyHeight(next);
    },
    [applyHeight, quickToggle],
  );

  const onClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    quickToggle();
  }, [quickToggle]);

  const collapseForTaskOpen = useCallback(
    (event: WebRemoteNavigationTaskOpen) => {
      if (!enabled || !isMobileViewport) {
        return;
      }
      collapsedRef.current = true;
      setIsCollapsed(true);
      if (event.crossWorkspace) {
        markWebRemoteNavigationCollapseOnce();
      }
    },
    [enabled, isMobileViewport],
  );

  return {
    heightPx,
    isCollapsed,
    isDragging,
    isPanelShown: isWebRemoteNavigationPanelShown({
      isCollapsed,
      isMobileViewport,
      isWebRemoteControlShell: enabled,
    }),
    onPointerDown,
    onPointerMove,
    finishPointer,
    onClick,
    collapseForTaskOpen,
  };
}

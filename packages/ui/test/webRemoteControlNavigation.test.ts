import assert from "node:assert/strict";
import test from "node:test";

import {
  WEB_REMOTE_NAVIGATION_COLLAPSE_ONCE_KEY,
  consumeWebRemoteNavigationCollapseOnce,
  expandedWebRemoteNavigationHeightPx,
  isWebRemoteNavigationPanelShown,
  markWebRemoteNavigationCollapseOnce,
  resolveWebRemoteNavigationHeight,
  toggleWebRemoteNavigationHeight,
} from "../src/web-remote/navigation/webRemoteControlNavigation.js";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

test("navigation height at or below 24px collapses", () => {
  assert.deepEqual(resolveWebRemoteNavigationHeight({ heightPx: 24, viewportHeight: 800 }), {
    heightPx: 0,
    isCollapsed: true,
  });
  assert.deepEqual(resolveWebRemoteNavigationHeight({ heightPx: 900, viewportHeight: 800 }), {
    heightPx: 584,
    isCollapsed: false,
  });
});

test("expanded navigation height follows the published viewport formula", () => {
  assert.equal(expandedWebRemoteNavigationHeightPx(800), 352);
  assert.equal(expandedWebRemoteNavigationHeightPx(400), 152);
});

test("toggle collapses an open panel and restores the expanded height", () => {
  assert.deepEqual(
    toggleWebRemoteNavigationHeight({
      currentHeightPx: 200,
      isCollapsed: false,
      viewportHeight: 800,
    }),
    { heightPx: 0, isCollapsed: true },
  );
  assert.deepEqual(
    toggleWebRemoteNavigationHeight({
      currentHeightPx: 0,
      isCollapsed: true,
      viewportHeight: 400,
    }),
    { heightPx: 152, isCollapsed: false },
  );
});

test("navigation panel stays visible unless a mobile web-remote shell is collapsed", () => {
  assert.equal(
    isWebRemoteNavigationPanelShown({
      isCollapsed: true,
      isMobileViewport: false,
      isWebRemoteControlShell: true,
    }),
    true,
  );
  assert.equal(
    isWebRemoteNavigationPanelShown({
      isCollapsed: true,
      isMobileViewport: true,
      isWebRemoteControlShell: true,
    }),
    false,
  );
});

test("collapse-once session flag is consumed a single time", () => {
  const storage = memoryStorage();
  markWebRemoteNavigationCollapseOnce(storage);
  assert.equal(storage.getItem(WEB_REMOTE_NAVIGATION_COLLAPSE_ONCE_KEY), "1");
  assert.equal(consumeWebRemoteNavigationCollapseOnce(storage), true);
  assert.equal(storage.getItem(WEB_REMOTE_NAVIGATION_COLLAPSE_ONCE_KEY), null);
  assert.equal(consumeWebRemoteNavigationCollapseOnce(storage), false);
});

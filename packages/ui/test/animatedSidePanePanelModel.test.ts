import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAnimatedSidePanePanelLayout,
  shouldOfferSelectionSideConversation,
  shouldRenderPreviewPaneHeavyContent,
} from "../src/app-shell/animatedSidePanePanelModel.js";

test("mobile overlay side pane fills the shell instead of the desktop split", () => {
  assert.deepEqual(resolveAnimatedSidePanePanelLayout({ mobileOverlay: true }), {
    collapsedSize: "0px",
    defaultSize: "100%",
    maxSize: "100%",
    minSize: "0px",
    useResizablePanel: false,
  });
  assert.equal(resolveAnimatedSidePanePanelLayout().useResizablePanel, true);
  assert.equal(resolveAnimatedSidePanePanelLayout().maxSize, "65%");
});

test("selection side conversation stays off on overlay and coarse mobile input", () => {
  assert.equal(
    shouldOfferSelectionSideConversation({
      activeTaskId: "task-1",
    }),
    true,
  );
  assert.equal(
    shouldOfferSelectionSideConversation({
      activeTaskId: "task-1",
      mobileOverlay: true,
    }),
    false,
  );
  assert.equal(
    shouldOfferSelectionSideConversation({
      activeTaskId: "task-1",
      isMobileTextInputViewport: true,
    }),
    false,
  );
  assert.equal(
    shouldOfferSelectionSideConversation({
      activeTaskId: null,
    }),
    false,
  );
});

test("overlay keeps preview content mounted when the pane is visible", () => {
  assert.equal(
    shouldRenderPreviewPaneHeavyContent({
      isActiveTab: true,
      isMobileOverlay: true,
      isResizeSettling: true,
      isSidePaneVisible: true,
      visibleInlineSizePx: 0,
    }),
    true,
  );
  assert.equal(
    shouldRenderPreviewPaneHeavyContent({
      isActiveTab: true,
      isMobileOverlay: true,
      isSidePaneVisible: false,
      visibleInlineSizePx: 400,
    }),
    false,
  );
});

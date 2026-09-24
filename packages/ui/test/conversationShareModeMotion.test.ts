import assert from "node:assert/strict";
import test from "node:test";

import { resolveConversationShareSelectionPanelMotion } from "../src/v4/conversationShareModeMotion.js";

test("share selection panel uses the published hidden transform literal", () => {
  const motion = resolveConversationShareSelectionPanelMotion(false);
  assert.notEqual(motion.initial, false);
  if (motion.initial === false) {
    return;
  }
  assert.equal(motion.initial.transform, "translate3d(-8px, -50%, 0)");
  assert.equal(motion.exit.transform, "translate3d(-8px, -50%, 0)");
  assert.equal(motion.animate.transform, "translate3d(0, -50%, 0)");
  assert.equal(motion.transition.duration, 0.2);
  assert.deepEqual(motion.transition.ease, [0.4, 0, 0.2, 1]);
});

test("reduced motion keeps the visible transform and skips the offset", () => {
  const motion = resolveConversationShareSelectionPanelMotion(true);
  assert.equal(motion.initial, false);
  assert.equal(motion.animate.transform, "translate3d(0, -50%, 0)");
  assert.equal(motion.exit.transform, "translate3d(0, -50%, 0)");
  assert.equal(motion.transition.duration, 0);
});

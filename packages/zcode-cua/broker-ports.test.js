import assert from "node:assert/strict";
import test from "node:test";

import { shouldRunCuaScreenCaptureProbe } from "./broker-ports.js";

test("screen capture probe runs only for an explicit functional probe while granted", () => {
  assert.equal(shouldRunCuaScreenCaptureProbe("granted", { includeFunctionalProbes: true }), true);
  assert.equal(shouldRunCuaScreenCaptureProbe("granted", {}), false);
  assert.equal(shouldRunCuaScreenCaptureProbe("granted", undefined), false);
  assert.equal(
    shouldRunCuaScreenCaptureProbe("denied", { includeFunctionalProbes: true }),
    false,
  );
  assert.equal(shouldRunCuaScreenCaptureProbe("stale", { includeFunctionalProbes: true }), false);
});

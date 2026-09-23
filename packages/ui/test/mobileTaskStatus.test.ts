import assert from "node:assert/strict";
import test from "node:test";

import { mobileTaskStatusClass } from "../src/web-remote/mobile/webRemoteControlMobileTaskStatus.js";

test("mobile task status classes match the published badge tones", () => {
  assert.equal(mobileTaskStatusClass("running"), "border-brand/40 bg-accent text-foreground");
  assert.equal(
    mobileTaskStatusClass("completed"),
    "border-success/40 bg-success text-success-foreground",
  );
  assert.equal(
    mobileTaskStatusClass("error"),
    "border-destructive/40 bg-destructive text-destructive-foreground",
  );
  assert.equal(mobileTaskStatusClass("idle"), "border-border bg-surface text-foreground-subtle");
});

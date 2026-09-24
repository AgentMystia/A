import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { scheduleMobilePlanAckReconcile } from "../src/v4/mobilePlanAckReconcile.js";

afterEach(() => {
  mock.timers.reset();
});

function createLease(pendingIds: string[]) {
  const pending = pendingIds.map((interactionId) => ({ interactionId }));
  const calls: string[] = [];
  return {
    calls,
    pending,
    lease: {
      store: {
        getState: () => ({ snapshot: { pendingInteractions: pending } }),
        recoverFromStaleAuthority: () => {
          calls.push("recover");
        },
      },
    },
  };
}

test("mobile plan ack waits 500ms and recovers only while the interaction is pending", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const harness = createLease(["plan-1"]);
  scheduleMobilePlanAckReconcile({
    interactionId: "plan-1",
    timers,
    compactForRemoteControl: true,
    lease: harness.lease,
    sessionId: "session-1",
    workspaceIdentity: "  remote-id  ",
    workspacePath: "/tmp/workspace",
  });
  scheduleMobilePlanAckReconcile({
    interactionId: "plan-1",
    timers,
    compactForRemoteControl: true,
    lease: harness.lease,
    sessionId: "session-1",
    workspaceIdentity: "  remote-id  ",
    workspacePath: "/tmp/workspace",
  });
  assert.equal(timers.size, 1);
  mock.timers.tick(499);
  assert.deepEqual(harness.calls, []);
  mock.timers.tick(1);
  assert.deepEqual(harness.calls, ["recover"]);
  assert.equal(timers.size, 0);
});

test("cleared pending and non-compact sessions do not recover", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const cleared = createLease(["plan-2"]);
  scheduleMobilePlanAckReconcile({
    interactionId: "plan-2",
    timers,
    compactForRemoteControl: true,
    lease: cleared.lease,
    sessionId: null,
    workspaceIdentity: " ",
    workspacePath: "/tmp/workspace",
  });
  cleared.pending.splice(0, cleared.pending.length);
  mock.timers.tick(500);
  assert.deepEqual(cleared.calls, []);

  const idle = createLease(["plan-3"]);
  scheduleMobilePlanAckReconcile({
    interactionId: "plan-3",
    timers,
    compactForRemoteControl: false,
    lease: idle.lease,
    sessionId: "session-3",
    workspaceIdentity: undefined,
    workspacePath: "/tmp/workspace",
  });
  scheduleMobilePlanAckReconcile({
    interactionId: "plan-3",
    timers,
    compactForRemoteControl: true,
    lease: null,
    sessionId: "session-3",
    workspaceIdentity: undefined,
    workspacePath: "/tmp/workspace",
  });
  mock.timers.tick(500);
  assert.deepEqual(idle.calls, []);
  assert.equal(timers.size, 0);
});

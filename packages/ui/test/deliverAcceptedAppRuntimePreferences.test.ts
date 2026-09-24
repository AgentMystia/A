import assert from "node:assert/strict";
import test from "node:test";

import { deliverAcceptedAppRuntimePreferences } from "../src/hooks/deliverAcceptedAppRuntimePreferences.js";

const preferences = {
  askUserQuestionAutoResolutionEnabled: true,
  modelIoFullRetentionEnabled: false,
};

test("accepted runtime preferences reach agent and bots before the broadcast", async () => {
  const order: string[] = [];
  await deliverAcceptedAppRuntimePreferences({
    zcodeAgentService: {
      async syncAppRuntimePreferences(payload) {
        order.push("agent");
        assert.deepEqual(payload, preferences);
      },
    },
    botsService: {
      async syncAppRuntimePreferences(payload) {
        order.push("bots");
        assert.deepEqual(payload, preferences);
      },
    },
    preferences,
    async broadcast(payload) {
      order.push("broadcast");
      assert.deepEqual(payload, preferences);
    },
  });
  assert.deepEqual(order, ["agent", "bots", "broadcast"]);
});

test("a sync rejection is thrown after the broadcast and does not skip the other service", async () => {
  const order: string[] = [];
  await assert.rejects(
    () =>
      deliverAcceptedAppRuntimePreferences({
        zcodeAgentService: {
          async syncAppRuntimePreferences() {
            order.push("agent");
            throw new Error("agent failed");
          },
        },
        botsService: {
          async syncAppRuntimePreferences() {
            order.push("bots");
          },
        },
        preferences,
        async broadcast() {
          order.push("broadcast");
        },
      }),
    /agent failed/,
  );
  assert.deepEqual(order, ["agent", "bots", "broadcast"]);
});

test("the first rejection is the agent when both services fail", async () => {
  let broadcastCount = 0;
  await assert.rejects(
    () =>
      deliverAcceptedAppRuntimePreferences({
        zcodeAgentService: {
          async syncAppRuntimePreferences() {
            throw new Error("agent failed");
          },
        },
        botsService: {
          async syncAppRuntimePreferences() {
            throw new Error("bots failed");
          },
        },
        preferences,
        async broadcast() {
          broadcastCount += 1;
        },
      }),
    /agent failed/,
  );
  assert.equal(broadcastCount, 1);
});

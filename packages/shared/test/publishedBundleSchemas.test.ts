import assert from "node:assert/strict";
import test from "node:test";

import { botsStateSchema } from "../src/bots.js";
import {
  cloudDialogButtonThemeSchema,
  cloudDialogPayloadSchema,
} from "../src/cloudDialogPayload.js";
import { marketingDeliverySchema } from "../src/marketingTouch.js";
import { CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID } from "../src/plugin-marketplaces.js";
import { zcodePermissionResponseSchema } from "../src/zcode-protocol-legacy-types.js";

test("marketing touch and cloud dialog share one button theme schema", () => {
  const popup = marketingDeliverySchema.options.find(
    (option) => option.shape.resource_position.value === "popup",
  );
  assert.ok(popup);
  assert.equal(
    popup.shape.popup.shape.buttons.element.shape.theme.unwrap().unwrap(),
    cloudDialogButtonThemeSchema,
  );
  assert.equal(
    cloudDialogPayloadSchema.shape.dialog.shape.buttons.element.shape.theme.unwrap().unwrap(),
    cloudDialogButtonThemeSchema,
  );
});

test("bot pending permission response reuses the shared permission schema", () => {
  assert.equal(CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID, "claude-plugins-official");
  const response =
    botsStateSchema.shape.bots.valueType.shape.pendingPermissionOptions.unwrap().element.shape
      .response;
  assert.equal(response, zcodePermissionResponseSchema);

  const state = {
    version: 3 as const,
    bots: {
      a: {
        botId: "a",
        workspacePath: "/tmp",
        mode: "draft" as const,
        activeTaskId: null,
        updatedAt: 1,
        pendingPermissionOptions: [
          {
            requestId: "r",
            optionId: "o",
            command: "approve" as const,
            label: "Allow",
            response: {
              decision: "allow" as const,
              permissionUpdates: [
                {
                  type: "addRules" as const,
                  behavior: "allow" as const,
                  rules: [{ toolName: "bash" }],
                },
              ],
            },
          },
        ],
      },
    },
  };
  assert.equal(
    botsStateSchema.parse(state).bots.a?.pendingPermissionOptions?.[0]?.response.decision,
    "allow",
  );
  const rejected = botsStateSchema.safeParse({
    ...state,
    bots: {
      a: {
        ...state.bots.a,
        pendingPermissionOptions: [
          {
            ...state.bots.a.pendingPermissionOptions[0],
            response: {
              decision: "allow",
              permissionUpdates: [{ type: "nope" }],
            },
          },
        ],
      },
    },
  });
  assert.equal(rejected.success, false);
});

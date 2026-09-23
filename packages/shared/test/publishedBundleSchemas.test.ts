import assert from "node:assert/strict";
import test from "node:test";

import { appSettingsPatchSchema, appSettingsSchema } from "../src/validationAppSettings.js";
import { botsStateSchema } from "../src/bots.js";
import { cloudContentBundleSchema } from "../src/cloudContent.js";
import {
  cloudDialogBundleSchema,
  cloudDialogButtonThemeSchema,
  cloudDialogPayloadSchema,
} from "../src/cloudDialogPayload.js";
import { marketingDeliverySchema } from "../src/marketingTouch.js";
import { CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID } from "../src/plugin-marketplaces.js";
import { zcodeProviderSchema } from "../src/providers.js";
import { zcodeAgentProviderSchema } from "../src/zcode-agent-policy.js";
import { zcodePermissionResponseSchema } from "../src/zcode-protocol-legacy-types.js";

test("published provider enum is shared and settings collapse it to glm", () => {
  assert.equal(zcodeAgentProviderSchema, zcodeProviderSchema);
  assert.equal(zcodeProviderSchema.parse("claude"), "claude");
  assert.equal(zcodeProviderSchema.safeParse("nope").success, false);

  const migrated = appSettingsSchema.parse({
    enabledBuiltinAgentCliProviders: ["nope"],
  });
  assert.deepEqual(migrated.enabledBuiltinAgentCliProviders, ["glm"]);

  const patched = appSettingsPatchSchema.parse({
    enabledBuiltinAgentCliProviders: ["opencode", "glm"],
  });
  assert.deepEqual(patched.enabledBuiltinAgentCliProviders, ["glm"]);
  assert.equal(
    appSettingsPatchSchema.safeParse({ enabledBuiltinAgentCliProviders: ["nope"] }).success,
    false,
  );
});

test("content bundle schema is the cloud dialog zip schema", () => {
  assert.equal(cloudContentBundleSchema, cloudDialogBundleSchema);
  const bundle = cloudContentBundleSchema.parse({
    format: "zip",
    url: "https://cdn.example/bundle.zip",
    entry: "index.html",
    sha256: "a".repeat(64),
    sizeBytes: 1024,
  });
  assert.equal(bundle.entry, "index.html");
  assert.equal(
    cloudContentBundleSchema.safeParse({
      format: "zip",
      url: "https://user:secret@cdn.example/bundle.zip",
      entry: "index.html",
      sha256: "a".repeat(64),
    }).success,
    false,
  );
});

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

import assert from "node:assert/strict";
import test from "node:test";

import {
  PUBLISHED_A11Y_FLATTENER_NAMES,
  PUBLISHED_AX_TEXT_ROLES,
  PUBLISHED_KEY_NAMES,
} from "./helper-published-ax-tables.js";
import {
  PUBLISHED_AX_NATIVE_BINDING,
  PUBLISHED_AX_ROLE_MAP,
  PUBLISHED_AX_VALUE_ROLES,
  PUBLISHED_DESKTOP_APP_IDS,
} from "./helper-published-ax-roles.js";
import {
  pipSessionEventSchema,
  pipSessionHandshakeSchema,
  pipSessionWindowSchema,
} from "./pip-session-schema.js";

test("published AX tables keep the side-effect constants from the main paths chunk", () => {
  assert.deepEqual(PUBLISHED_A11Y_FLATTENER_NAMES, [
    "associateTitleUIElements",
    "flattenIntoSelectableAncestor",
    "pruneEmptyDisabledElements",
    "mergeSingleItemGroups",
    "flattenRepetitiveStaticText",
    "flattenLinksIntoMarkdownText",
  ]);
  assert.equal(PUBLISHED_AX_TEXT_ROLES.has("searchfield"), true);
  assert.equal(PUBLISHED_AX_VALUE_ROLES.has("searchfield"), false);
  assert.equal(PUBLISHED_AX_ROLE_MAP.Button, "button");
  assert.equal(PUBLISHED_AX_ROLE_MAP.ListItem, "row");
  assert.equal(PUBLISHED_AX_ROLE_MAP.Custom, "");
  assert.equal(PUBLISHED_KEY_NAMES.has("forwarddelete"), true);
  assert.equal(PUBLISHED_KEY_NAMES.has("f16"), true);
  assert.equal(PUBLISHED_KEY_NAMES.has("f17"), false);
  assert.deepEqual(PUBLISHED_DESKTOP_APP_IDS, ["dev.zcode.app", "dev.zcode.app.preview"]);
  assert.equal(PUBLISHED_AX_NATIVE_BINDING, "build/Release/ax_native.node");
});

test("PiP event schema matches the published strict object", () => {
  assert.deepEqual(
    pipSessionEventSchema.parse({
      kind: "focus-changed",
      revision: 1,
      sourceWindowId: " window-1 ",
      sessionId: null,
    }),
    {
      kind: "focus-changed",
      revision: 1,
      sourceWindowId: "window-1",
      sessionId: null,
    },
  );
  assert.equal(
    pipSessionEventSchema.safeParse({
      kind: "turn-started",
      sessionId: "__zcode_pip_no_active_session_v2__",
      turnId: "turn",
      sequenceNumber: 1,
      eventId: "event",
    }).success,
    false,
  );
  assert.equal(
    pipSessionEventSchema.safeParse({
      kind: "turn-ended",
      sessionId: "session",
      turnId: "turn",
      sequenceNumber: 1,
      eventId: "event",
      outcome: "completed",
      extra: true,
    }).success,
    false,
  );
  assert.equal(
    pipSessionWindowSchema.parse({
      windowId: 2,
      pid: 4,
      bundleId: "dev.zcode.app",
    }).windowId,
    2,
  );
  assert.deepEqual(
    pipSessionHandshakeSchema.parse({ protocolVersion: 2, runtimeId: "zcode-cua-pip-session-v2" }),
    { protocolVersion: 2, runtimeId: "zcode-cua-pip-session-v2" },
  );
});

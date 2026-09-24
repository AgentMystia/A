import assert from "node:assert/strict";
import test from "node:test";

import { cloudDialogPayloadSchema } from "../src/cloudDialogPayload.js";

const imagePayload = {
  schemaVersion: 1,
  id: "campaign-1",
  revision: 1,
  kind: "feature",
  locale: "zh-CN",
  dialog: {
    title: "Hello",
    description: { format: "plain_text", text: "Body" },
    hero: {
      type: "image",
      src: "https://cdn.example/a.png",
      alt: "a",
      fit: "contain",
    },
    buttons: [
      {
        id: "go",
        label: "Go",
        variant: "link",
        theme: { variant: "" },
        actionId: "go",
      },
    ],
  },
  actions: {
    go: { type: "navigate", destination: "model_settings" },
  },
} as const;

test("cloud dialog payload accepts the published hero and action contract", () => {
  const parsed = cloudDialogPayloadSchema.parse(imagePayload);
  assert.equal(parsed.dialog.buttons[0]?.theme?.variant, "default");
  assert.equal(parsed.actions.go?.type, "navigate");

  const interactive = cloudDialogPayloadSchema.parse({
    ...imagePayload,
    kind: "notice",
    locale: "en-US",
    dialog: {
      ...imagePayload.dialog,
      hero: {
        type: "interactive_bundle",
        runtime: "zcode-hero-sandbox-v1",
        bundle: {
          format: "zip",
          url: "https://cdn.example/hero.zip",
          entry: "index.html",
          sha256: "a".repeat(64),
        },
        viewport: { aspectRatio: "4:3" },
        data: { planName: "Pro" },
        events: { replay: "replay" },
      },
    },
    actions: {
      go: { type: "dismiss_content" },
    },
  });
  assert.equal(interactive.dialog.hero.type, "interactive_bundle");
});

test("cloud dialog payload rejects a duplicate button or missing action", () => {
  const duplicate = cloudDialogPayloadSchema.safeParse({
    ...imagePayload,
    dialog: {
      ...imagePayload.dialog,
      buttons: [
        imagePayload.dialog.buttons[0],
        { ...imagePayload.dialog.buttons[0], label: "Again" },
      ],
    },
  });
  assert.equal(duplicate.success, false);
  if (!duplicate.success) {
    assert.equal(duplicate.error.issues[0]?.message, "Duplicate button or missing action");
  }

  const missing = cloudDialogPayloadSchema.safeParse({
    ...imagePayload,
    actions: { other: { type: "close" } },
  });
  assert.equal(missing.success, false);
  if (!missing.success) {
    assert.equal(missing.error.issues[0]?.message, "Duplicate button or missing action");
  }
});

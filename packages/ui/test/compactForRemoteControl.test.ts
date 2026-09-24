import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAssistantPreviewCardsFromReferences,
  shouldOpenAssistantHtmlInBrowser,
} from "../src/lib/assistantPreviewCards.js";
import type { AssistantFileReference } from "../src/lib/assistantFileReferences.js";
import { resolveGreetingFontSizePx } from "../src/v4/greetingFontSize.js";

test("remote compact greeting stays at the 20px floor", () => {
  assert.equal(
    resolveGreetingFontSizePx({
      availableWidthPx: 1000,
      naturalTextWidthPx: 100,
      compactForRemoteControl: true,
    }),
    20,
  );
  assert.equal(
    resolveGreetingFontSizePx({
      availableWidthPx: 1000,
      naturalTextWidthPx: 100,
    }),
    30,
  );
});

test("remote compact html stays inside the app preview", () => {
  const path = "/workspace/preview.html";
  assert.equal(shouldOpenAssistantHtmlInBrowser({ path }), true);
  assert.equal(shouldOpenAssistantHtmlInBrowser({ path, compactForRemoteControl: true }), false);
  assert.equal(shouldOpenAssistantHtmlInBrowser({ path, workspaceIdentity: "remote-host" }), false);
});

test("remote compact drops localhost and html preview cards", () => {
  const content = "open http://127.0.0.1:4173/demo";
  const htmlReference: AssistantFileReference = {
    kind: "html",
    path: "/workspace/demo.html",
    raw: "demo.html",
    start: 0,
    end: 4,
  };

  assert.equal(
    buildAssistantPreviewCardsFromReferences(content, "/workspace", [], {
      suppressWebRemoteCards: true,
    }).length,
    0,
  );
  assert.equal(
    buildAssistantPreviewCardsFromReferences(content, "/workspace", [], {}).some(
      (card) => card.type === "website",
    ),
    true,
  );
  assert.equal(
    buildAssistantPreviewCardsFromReferences("see demo.html", "/workspace", [htmlReference], {
      changedFilePaths: ["/workspace/demo.html"],
      suppressWebRemoteCards: true,
    }).length,
    0,
  );
  assert.equal(
    buildAssistantPreviewCardsFromReferences("see demo.html", "/workspace", [htmlReference], {
      changedFilePaths: ["/workspace/demo.html"],
    }).some((card) => card.type === "website" && card.url.startsWith("file:")),
    true,
  );
});

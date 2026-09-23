import assert from "node:assert/strict";
import test from "node:test";

import { fitComposerToolbar } from "../src/prompt-editor/useComposerToolbarFit.js";

interface FakeElement {
  dataset: Record<string, string | undefined>;
  className: string;
  width: number;
  attrs: Record<string, string | undefined>;
  children: FakeElement[];
  compactWidth?: number;
  iconWidth?: number;
  querySelector(selector: string): FakeElement | null;
  querySelectorAll(selector: string): FakeElement[];
  getBoundingClientRect(): { width: number };
}

function matches(element: FakeElement, selector: string): boolean {
  if (selector.startsWith(".")) {
    return element.className.split(/\s+/).includes(selector.slice(1));
  }
  const attr = selector.slice(1, -1);
  return Object.prototype.hasOwnProperty.call(element.attrs, attr);
}

function createElement(options: {
  width: number;
  className?: string;
  attrs?: Record<string, string | undefined>;
  children?: FakeElement[];
  compactWidth?: number;
  iconWidth?: number;
}): FakeElement {
  const datasetStore: Record<string, string | undefined> = {};
  if (options.attrs?.["data-composer-collapse-priority"]) {
    datasetStore.composerCollapsePriority = options.attrs["data-composer-collapse-priority"];
  }
  const element: FakeElement = {
    dataset: {},
    className: options.className ?? "",
    width: options.width,
    attrs: options.attrs ?? {},
    children: options.children ?? [],
    compactWidth: options.compactWidth,
    iconWidth: options.iconWidth,
    querySelector(selector) {
      if (matches(element, selector)) return element;
      for (const child of element.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    },
    querySelectorAll(selector) {
      const found: FakeElement[] = [];
      if (matches(element, selector)) found.push(element);
      for (const child of element.children) found.push(...child.querySelectorAll(selector));
      return found;
    },
    getBoundingClientRect() {
      return { width: element.width };
    },
  };
  element.dataset = new Proxy(datasetStore, {
    get: (target, key) => target[String(key)],
    set: (target, key, value) => {
      target[String(key)] = String(value);
      if (key === "composerCompact" && value === "true" && element.compactWidth !== undefined) {
        element.width = element.compactWidth;
      }
      if (key === "composerCompact" && value === "icon" && element.iconWidth !== undefined) {
        element.width = element.iconWidth;
      }
      if (key === "composerProviderCompact" && value === "true") {
        const prefix = element.querySelector(".composer-provider-prefix");
        if (prefix) prefix.width = 0;
      }
      return true;
    },
    deleteProperty: (target, key) => {
      delete target[String(key)];
      return true;
    },
  });
  return element;
}

function control(
  priority: string,
  width: number,
  compactWidth: number,
  extra?: { thought?: boolean; iconWidth?: number },
) {
  return createElement({
    width,
    compactWidth,
    iconWidth: extra?.iconWidth,
    attrs: {
      "data-composer-collapse-priority": priority,
      ...(extra?.thought ? { "data-composer-thought-control": "true" } : {}),
    },
    children: extra?.thought
      ? [createElement({ width: 0, className: "composer-provider-prefix" })]
      : [],
  });
}

function mount(controls: FakeElement[], rootWidth = 300, leadingWidth = 200) {
  const content = createElement({
    width: 0,
    attrs: { "data-composer-leading-content": "" },
    children: controls,
  });
  content.getBoundingClientRect = () => ({
    width: controls.reduce((sum, control) => sum + control.getBoundingClientRect().width, 0),
  });
  const leading = createElement({
    width: leadingWidth,
    attrs: { "data-composer-leading-actions": "" },
    children: [content],
  });
  // leading width must stay fixed; its getter would otherwise sum children.
  leading.getBoundingClientRect = () => ({ width: leadingWidth });
  const trailing = createElement({
    width: 36,
    attrs: { "data-composer-trailing-actions": "" },
  });
  const root = createElement({
    width: rootWidth,
    children: [leading, trailing],
  });
  root.getBoundingClientRect = () => ({ width: rootWidth });
  return root;
}

function withColumnGap(run: () => void) {
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (() => ({ columnGap: "12px" })) as typeof getComputedStyle;
  try {
    run();
  } finally {
    globalThis.getComputedStyle = original;
  }
}

test("composer fit stops before later priorities once overflow is gone", () => {
  withColumnGap(() => {
    const mode = control("0", 80, 70);
    const cua = control("1", 70, 28);
    const plan = control("2", 60, 28);
    const thought = control("3", 40, 28, { thought: true, iconWidth: 28 });
    const root = mount([mode, cua, plan, thought]);
    fitComposerToolbar(root as unknown as HTMLElement);
    assert.equal(mode.dataset.composerCompact, "true");
    assert.equal(cua.dataset.composerCompact, "true");
    assert.equal(plan.dataset.composerCompact, undefined);
    assert.equal(thought.dataset.composerCompact, undefined);
    assert.equal(root.dataset.composerProviderCompact, undefined);
    assert.equal(root.dataset.composerModelIcon, undefined);
  });
});

test("composer fit turns the thought control into an icon before the model icon", () => {
  withColumnGap(() => {
    const mode = control("0", 80, 70);
    const thought = control("3", 160, 150, { thought: true, iconWidth: 28 });
    const root = mount([mode, thought], 220, 120);
    fitComposerToolbar(root as unknown as HTMLElement);
    assert.equal(mode.dataset.composerCompact, "true");
    assert.equal(thought.dataset.composerCompact, "icon");
    assert.equal(root.dataset.composerProviderCompact, "true");
    assert.equal(root.dataset.composerModelIcon, undefined);
  });
});

test("composer fit sets the model icon when the thought icon still overflows", () => {
  withColumnGap(() => {
    const thought = control("3", 400, 300, { thought: true, iconWidth: 280 });
    const root = mount([thought], 200, 100);
    fitComposerToolbar(root as unknown as HTMLElement);
    assert.equal(thought.dataset.composerCompact, "icon");
    assert.equal(root.dataset.composerModelIcon, "true");
  });
});

test("composer fit leaves a fitting toolbar untouched", () => {
  withColumnGap(() => {
    const mode = control("0", 40, 28);
    const root = mount([mode], 400, 300);
    fitComposerToolbar(root as unknown as HTMLElement);
    assert.equal(mode.dataset.composerCompact, undefined);
    assert.equal(root.dataset.composerModelIcon, undefined);
  });
});

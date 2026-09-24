import assert from "node:assert/strict";
import test from "node:test";

import { resolveWebRemoteNavigationScrollChrome } from "../src/lib/webRemoteNavigationScroll.js";

test("web remote navigation scroll chrome is only present while the remote shell is active", () => {
  assert.deepEqual(resolveWebRemoteNavigationScrollChrome(true), {
    scrollDataAttribute: "true",
    scrollClassName: "max-md:overflow-y-auto",
    contentClassName: "max-md:pt-11",
    dragSpacerClassName: "max-md:hidden",
  });
  assert.deepEqual(resolveWebRemoteNavigationScrollChrome(false), {
    scrollDataAttribute: undefined,
    scrollClassName: undefined,
    contentClassName: undefined,
    dragSpacerClassName: undefined,
  });
});

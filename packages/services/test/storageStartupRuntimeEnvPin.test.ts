import assert from "node:assert/strict";
import test from "node:test";
import { initializeRuntimeProcessEnv } from "../src/runtime-tools/runtimeCommandEnv.js";

test("tasks storage startup references runtime env without applying it", async () => {
  const pathBefore = process.env.PATH;
  await import("../src/storage-startup.js");
  assert.equal(process.env.PATH, pathBefore);
  assert.equal(typeof initializeRuntimeProcessEnv, "function");
});

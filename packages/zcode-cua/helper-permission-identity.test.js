import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { resolveHelperPermissionSubjectIdentityForTest as resolveHelperPermissionSubjectIdentity } from "./helper-permission-identity.js";

const APP = "/Applications/ZCode Computer Use.app";
const CANONICAL = "/canonical/ZCode Computer Use.app";

function fakeIo(values, calls) {
  return {
    async realpath(path) {
      if (path === APP) return CANONICAL;
      return path;
    },
    execFile(command, args, options, callback) {
      calls.push({ command, args, options });
      const key = String(args[1]).slice("Print :".length);
      const value = values[key];
      if (value instanceof Error) {
        callback(value);
        return;
      }
      callback(null, value);
    },
  };
}

test("permission identity reads the three plist keys and canonicalizes both paths", async () => {
  const calls = [];
  const identity = await resolveHelperPermissionSubjectIdentity(
    APP,
    fakeIo(
      {
        CFBundleIdentifier: " dev.zcode.cua-helper \n",
        CFBundleDisplayName: "  ZCode Computer Use  \n",
        CFBundleExecutable: " ZCode Computer Use \n",
      },
      calls,
    ),
  );
  assert.deepEqual(identity, {
    appPath: CANONICAL,
    executablePath: join(CANONICAL, "Contents", "MacOS", "ZCode Computer Use"),
    displayName: "ZCode Computer Use",
    bundleId: "dev.zcode.cua-helper",
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((call) => call.args[1]),
    ["Print :CFBundleIdentifier", "Print :CFBundleDisplayName", "Print :CFBundleExecutable"],
  );
  for (const call of calls) {
    assert.equal(call.command, "/usr/libexec/PlistBuddy");
    assert.equal(call.options.timeout, 2000);
    assert.equal(call.options.encoding, "utf8");
    assert.equal(call.options.env.PATH, "/usr/bin:/bin:/usr/sbin:/sbin");
    assert.equal(call.args[2], join(CANONICAL, "Contents", "Info.plist"));
  }
});

test("a blank display name falls back to the app basename", async () => {
  const identity = await resolveHelperPermissionSubjectIdentity(
    APP,
    fakeIo(
      {
        CFBundleIdentifier: "dev.zcode.cua-helper",
        CFBundleDisplayName: "   ",
        CFBundleExecutable: "Helper",
      },
      [],
    ),
  );
  assert.equal(identity.displayName, "ZCode Computer Use");
  assert.equal(identity.executablePath, join(CANONICAL, "Contents", "MacOS", "Helper"));
});

test("a missing plist identity is verification_failed", async () => {
  await assert.rejects(
    () =>
      resolveHelperPermissionSubjectIdentity(
        APP,
        fakeIo(
          {
            CFBundleIdentifier: " \n",
            CFBundleDisplayName: "ZCode Computer Use",
            CFBundleExecutable: "Helper",
          },
          [],
        ),
      ),
    (error) => {
      assert.equal(error.code, "verification_failed");
      assert.equal(
        error.message,
        `ZCode Computer Use Info.plist is missing its permission identity at ${CANONICAL}`,
      );
      return true;
    },
  );
});

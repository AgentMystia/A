import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CuaHelperError } from "./broker.js";
import { HELPER_APP_NAME, HELPER_BUNDLE_ID } from "./broker-helper-constants.js";
import { assertSafeHelperDownloadUrl, redactHelperDownloadUrl } from "./helper-download.js";
import { parseMachoArchNames } from "./helper-macho.js";
import { isUnsafeZipEntryName } from "./helper-install-archive.js";
import { acquireMacOSCuaHelperInstallLease } from "./helper-install-lease.js";
import {
  EXPECTED_CUA_HELPER_TEAM_ID,
  PACKAGED_CUA_HELPER_VERSION,
  resolveCuaHelperInstallPlan,
} from "./helper-install-plan.js";
import { createCuaHelperInstaller } from "./helper-install-stage.js";

function productionEnv(home) {
  return {
    HOME: home,
    ZCODE_RUNTIME_ENV: "production",
    ZCODE_ENV: "production",
  };
}

async function withDarwin(run) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...descriptor, value: "darwin" });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
}

test("CuaHelperError keeps the published code-then-message order", () => {
  const error = new CuaHelperError("install_failed", "refused", { cause: new Error("disk") });
  assert.equal(error.code, "install_failed");
  assert.equal(error.message, "refused");
  assert.equal(error.cause.message, "disk");
});

test("packaged auto-install refuses a non-macOS host", () => {
  assert.throws(
    () => resolveCuaHelperInstallPlan({ env: productionEnv("/tmp/zcode-home") }),
    (error) => {
      assert.ok(error instanceof CuaHelperError);
      assert.equal(error.code, "install_failed");
      assert.match(error.message, /only supported on macOS, got linux/);
      return true;
    },
  );
});

test("local development install plan reports the published failure codes", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    await assert.rejects(
      async () =>
        resolveCuaHelperInstallPlan({
          env: { ZCODE_RUNTIME_ENV: "development", ZCODE_TARGET_OS: "darwin" },
        }),
      (error) => {
        assert.equal(error.code, "install_failed");
        assert.match(error.message, /\$\{ZCODE_HOME:-\$HOME\/\.zcode\}/);
        return true;
      },
    );
    const home = await mkdtemp(join(tmpdir(), "zcode-cua-plan-"));
    try {
      assert.throws(
        () =>
          resolveCuaHelperInstallPlan({
            env: {
              ZCODE_HOME: home,
              ZCODE_RUNTIME_ENV: "development",
              ZCODE_TARGET_OS: "darwin",
              ZCODE_TARGET_ARCH: "mips",
            },
          }),
        (error) => {
          assert.match(error.message, /Unsupported ZCode Computer Use arch: mips/);
          return true;
        },
      );
      assert.throws(
        () =>
          resolveCuaHelperInstallPlan({
            env: {
              ZCODE_HOME: home,
              ZCODE_RUNTIME_ENV: "development",
              ZCODE_TARGET_OS: "darwin",
              ZCODE_CUA_HELPER_INSTALL_VARIANT: "nope",
            },
          }),
        (error) => {
          assert.match(error.message, /ZCODE_CUA_HELPER_INSTALL_VARIANT/);
          return true;
        },
      );
      const downloadPlan = resolveCuaHelperInstallPlan({
        env: {
          ZCODE_HOME: home,
          ZCODE_RUNTIME_ENV: "development",
          ZCODE_TARGET_OS: "darwin",
          ZCODE_TARGET_ARCH: "arm64",
          ZCODE_CUA_HELPER_DOWNLOAD_BASE_URL: "https://example.test/helpers/",
        },
      });
      assert.equal(downloadPlan.source.kind, "download");
      assert.equal(downloadPlan.version, "0.0.0");
      assert.equal(downloadPlan.installRoot, join(home, "computer-use", "dev"));
      assert.equal(
        downloadPlan.source.url,
        "https://example.test/helpers/ZCode-CUA-Helper-0.0.0-mac-arm64.zip",
      );
      const bundledPlan = resolveCuaHelperInstallPlan({
        env: {
          ZCODE_HOME: home,
          ZCODE_RUNTIME_ENV: "development",
          ZCODE_TARGET_OS: "macos",
          ZCODE_TARGET_ARCH: "x86_64",
        },
        bundledAppPath: "/Applications/ZCode Computer Use.app",
      });
      assert.deepEqual(bundledPlan.source, {
        kind: "bundled",
        appPath: "/Applications/ZCode Computer Use.app",
      });
      assert.equal(bundledPlan.arch, "x64");
      assert.equal(bundledPlan.expectedBundleId, HELPER_BUNDLE_ID);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("packaged darwin plan pins the published helper version, team, and build id", async () => {
  await withDarwin(async () => {
    const home = await mkdtemp(join(tmpdir(), "zcode-cua-packaged-"));
    try {
      assert.throws(
        () => resolveCuaHelperInstallPlan({ env: productionEnv(home) }),
        (error) => {
          assert.match(error.message, /embedded Computer Use Helper build identity/);
          return true;
        },
      );
      assert.throws(
        () =>
          resolveCuaHelperInstallPlan({
            env: productionEnv(home),
            embeddedBuildId: "pipeline-291748-cead36fd",
          }),
        (error) => {
          assert.match(error.message, /missing its bundled ZCode Computer Use\.app path/);
          return true;
        },
      );
      const plan = resolveCuaHelperInstallPlan({
        env: productionEnv(home),
        embeddedBuildId: "pipeline-291748-cead36fd",
        bundledAppPath: "/Applications/ZCode Computer Use.app",
      });
      assert.equal(plan.version, PACKAGED_CUA_HELPER_VERSION);
      assert.equal(plan.expectedTeamIdentifier, EXPECTED_CUA_HELPER_TEAM_ID);
      assert.equal(plan.expectedBuildId, "pipeline-291748-cead36fd");
      assert.equal(plan.installRoot, join(home, ".zcode", "computer-use"));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

test("install lease and download guards fail closed off macOS", async () => {
  await assert.rejects(acquireMacOSCuaHelperInstallLease({ installRoot: "/tmp" }), (error) => {
    assert.equal(error.code, "install_failed");
    assert.match(error.message, /O_EXLOCK/);
    return true;
  });
  assert.throws(
    () => assertSafeHelperDownloadUrl("ftp://example.test/helper.zip"),
    (error) => {
      assert.equal(error.code, "download_failed");
      assert.match(error.message, /unsupported scheme/);
      return true;
    },
  );
  assert.equal(
    redactHelperDownloadUrl("https://user:secret@example.test/helper.zip?token=1"),
    "https://example.test/helper.zip",
  );
  assert.equal(isUnsafeZipEntryName("../Helper.app"), true);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4);
  header.writeUInt32LE(0, 8);
  assert.deepEqual(parseMachoArchNames(header), ["arm64"]);
});

test("ensureInstalled stages a bundled helper through the injected verifier", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const root = await mkdtemp(join(tmpdir(), "zcode-cua-install-"));
  const bundled = join(root, "bundled.app");
  await mkdir(bundled, { recursive: true });
  await writeFile(join(bundled, "payload"), "helper");
  const home = join(root, "home");
  let leaseAcquires = 0;
  try {
    const installer = createCuaHelperInstaller({
      env: {
        ZCODE_HOME: home,
        ZCODE_RUNTIME_ENV: "development",
        ZCODE_TARGET_OS: "darwin",
        ZCODE_TARGET_ARCH: "arm64",
      },
      bundledAppPath: bundled,
      dependencies: {
        async acquireInstallLease() {
          leaseAcquires += 1;
          return { assertHeld() {}, async release() {} };
        },
        async readBundleInfo() {
          return {
            bundleId: HELPER_BUNDLE_ID,
            version: "0.0.0",
            buildVersion: "0.0.0",
            executableName: "ZCode Computer Use",
            buildId: null,
          };
        },
        async readExecutableArchs() {
          return ["arm64"];
        },
        async verifyCodeSignature() {},
        async inspectCodesignDetails() {
          return {
            teamIdentifier: EXPECTED_CUA_HELPER_TEAM_ID,
            authorities: [],
            rawOutput: "",
            adHoc: false,
          };
        },
        async assessGatekeeper() {},
        async clearQuarantine() {},
      },
    });
    const [first, second] = await Promise.all([
      installer.ensureInstalled(),
      installer.ensureInstalled(),
    ]);
    const expected = join(home, "computer-use", "dev", HELPER_APP_NAME);
    assert.equal(first, expected);
    assert.equal(second, expected);
    assert.equal(leaseAcquires, 1);
    const installed = await readFile(join(expected, "payload"), "utf8");
    assert.equal(installed, "helper");
    const meta = JSON.parse(
      await readFile(join(home, "computer-use", "dev", ".zcode-cua-helper-meta.json"), "utf8"),
    );
    assert.equal(meta.provider, "zcode-cua-helper");
    assert.equal(meta.source, "bundled:zcode-app");
    assert.equal(meta.verificationMode, "release");
    await installer.verifyInstalled(expected, { skipGatekeeperAssessment: true });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    await rm(root, { recursive: true, force: true });
  }
});

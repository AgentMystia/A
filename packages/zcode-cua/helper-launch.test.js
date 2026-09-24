import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CuaHelperError, resolveBrokerSocketPath } from "./broker.js";
import { CuaHelperHost } from "./helper-host.js";
import {
  buildHelperOpenArgs,
  isSafeCuaHelperBrokerLaunchGuard,
  prepareCuaHelperBrokerLaunchGuard,
  publishCuaHelperBrokerLaunchCancellation,
} from "./helper-launch.js";
import { STABLE_BROKER_SOCKET_NAME } from "./helper-broker-runtime.js";

test("settings probe args omit launcher pid and PiP flags", () => {
  const args = buildHelperOpenArgs({
    appPath: "/Applications/ZCode Computer Use.app",
    socketPath: "/tmp/zcode-cua-probe.sock",
    exitLogPath: "/tmp/zcode-cua-probe.sock.settings.exit.log",
    allowUnsignedLauncherLocalDev: true,
    allowExternalBrokerClientLocalDev: true,
  });
  assert.deepEqual(args, [
    "-n",
    "-g",
    "/Applications/ZCode Computer Use.app",
    "--args",
    "--socket",
    "/tmp/zcode-cua-probe.sock",
    "--exit-log",
    "/tmp/zcode-cua-probe.sock.settings.exit.log",
    "--allow-unsigned-launcher-local-dev",
    "--allow-external-broker-client-local-dev",
  ]);
});

test("an unsafe broker launch guard is refused before open", () => {
  assert.equal(
    isSafeCuaHelperBrokerLaunchGuard("/tmp/helper.sock", {
      deadlineEpochMs: 1,
      cancelFilePath: "/tmp/not-a-sentinel",
    }),
    false,
  );
  assert.throws(
    () =>
      buildHelperOpenArgs({
        appPath: "/Applications/ZCode Computer Use.app",
        socketPath: "/tmp/helper.sock",
        brokerLaunchGuard: { deadlineEpochMs: 1, cancelFilePath: "/tmp/not-a-sentinel" },
      }),
    (error) => {
      assert.equal(error instanceof CuaHelperError, true);
      assert.equal(error.code, "launch_failed");
      assert.match(error.message, /unsafe Computer Use Helper broker launch guard/);
      return true;
    },
  );
});

test("prepare refuses a launch guard outside the published window", async () => {
  await assert.rejects(
    prepareCuaHelperBrokerLaunchGuard({
      socketPath: "relative.sock",
      deadlineEpochMs: Date.now() + 1_000,
    }),
    (error) => error instanceof CuaHelperError && error.code === "launch_failed",
  );
});

test("a prepared launch guard can be passed to open and cancelled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cua-launch-"));
  try {
    const socketPath = join(directory, "broker.sock");
    const deadlineEpochMs = Date.now() + 60_000;
    const guard = await prepareCuaHelperBrokerLaunchGuard({ socketPath, deadlineEpochMs });
    assert.equal(isSafeCuaHelperBrokerLaunchGuard(socketPath, guard), true);
    const args = buildHelperOpenArgs(
      {
        appPath: "/Applications/ZCode Computer Use.app",
        socketPath,
        brokerLaunchGuard: guard,
      },
      42,
    );
    assert.equal(args.includes("--launcher-pid"), true);
    assert.equal(args[args.indexOf("--launcher-pid") + 1], "42");
    assert.equal(args.includes("--broker-launch-cancel-file"), true);
    publishCuaHelperBrokerLaunchCancellation(socketPath, guard);
    assert.throws(
      () =>
        publishCuaHelperBrokerLaunchCancellation(socketPath, {
          deadlineEpochMs: 1,
          cancelFilePath: "/tmp/not-a-sentinel",
        }),
      (error) => error instanceof CuaHelperError && error.code === "termination_failed",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stable broker socket stays in the runtime directory", () => {
  const socketPath = resolveBrokerSocketPath({
    env: { XDG_RUNTIME_DIR: "/tmp/zcode-runtime" },
  });
  assert.equal(socketPath, join("/tmp/zcode-runtime", "zcode-cua", STABLE_BROKER_SOCKET_NAME));
});

test("start without a helper bundle reports helper_missing", async () => {
  const host = new CuaHelperHost({
    env: { HOME: "/tmp/zcode-home", ZCODE_RUNTIME_ENV: "production", ZCODE_ENV: "production" },
    helperAppCandidates: [],
    helperInstaller: {
      async ensureInstalled() {
        return "/tmp/zcode-home/missing-helper.app";
      },
      async verifyInstalled() {},
    },
    launcher: {
      async launch() {
        throw new Error("should not launch");
      },
    },
    createTransportReservation: async () => null,
  });
  await assert.rejects(host.start(), (error) => {
    assert.equal(error.code, "helper_missing");
    assert.match(error.message, /internal candidate\(s\) checked/);
    return true;
  });
});

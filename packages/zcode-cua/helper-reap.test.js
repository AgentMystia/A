import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { brokerRuntimeDir } from "./helper-broker-runtime.js";
import { helperLogLines, pruneHelperLogs } from "./helper-exit-log.js";
import { standaloneHelperExecutablePaths } from "./helper-process-evidence.js";
import { isLikelyZCodeOwnerCommand, reapOrphanedHelpers } from "./helper-reap.js";
import { isScreenCaptureProbeSuccess } from "./helper-screen-probe.js";

const HELPER_ENV = {
  HOME: "/tmp/zcode-reap-home",
  ZCODE_HOME: "/tmp/zcode-reap-root",
  ZCODE_ENV: "production",
  ZCODE_RUNTIME_ENV: "production",
  XDG_RUNTIME_DIR: "/tmp/zcode-reap-xdg",
};

function helperCommand(ownerPid) {
  const executable = standaloneHelperExecutablePaths(HELPER_ENV)[0];
  const socket = join(brokerRuntimeDir(HELPER_ENV), "broker-0123456789abcdef.sock");
  return {
    executable,
    socket,
    command: `${executable} --socket ${socket} --launcher-pid ${ownerPid}`,
  };
}

function helperRow(pid, ownerPid, uid = 501) {
  return { pid, ppid: 1, uid, command: helperCommand(ownerPid).command };
}

test("reap skips non-darwin and a live launcher", () => {
  let listed = false;
  const skipped = reapOrphanedHelpers({
    platform: "linux",
    currentUid: 501,
    listProcesses: () => {
      listed = true;
      return [];
    },
  });
  assert.deepEqual(skipped, { scanned: 0, reaped: [] });
  assert.equal(listed, false);

  const killed = [];
  const spared = reapOrphanedHelpers({
    platform: "darwin",
    env: HELPER_ENV,
    currentUid: 501,
    selfPid: 7,
    canonicalizePath: (path) => path,
    isProcessAlive: () => true,
    listProcesses: () => [helperRow(40, 50)],
    killProcess: (pid) => {
      killed.push(pid);
    },
  });
  assert.deepEqual(spared, { scanned: 1, reaped: [] });
  assert.deepEqual(killed, []);
});

test("reap sends SIGTERM only after a dead or unrelated launcher recheck", () => {
  const warnings = [];
  const infos = [];
  const logger = {
    warn(_scope, message) {
      warnings.push(message);
    },
    info(_scope, message) {
      infos.push(message);
    },
  };
  const killed = [];
  let listed = 0;
  const orphan = helperRow(40, 50);
  const reaped = reapOrphanedHelpers({
    platform: "darwin",
    env: HELPER_ENV,
    currentUid: 501,
    selfPid: 7,
    logger,
    canonicalizePath: (path) => path,
    isProcessAlive: () => false,
    listProcesses: () => {
      listed += 1;
      return [orphan, { pid: 41, ppid: 20, uid: 501, command: "/bin/zsh" }];
    },
    killProcess: (pid) => {
      killed.push(pid);
    },
  });
  assert.deepEqual(killed, [40]);
  assert.deepEqual(reaped.reaped, [40]);
  assert.equal(reaped.scanned, 2);
  assert.equal(listed, 2);
  assert.match(infos[0], /SIGTERM'd 1 orphaned Helper/);

  let alive = false;
  const reused = [];
  reapOrphanedHelpers({
    platform: "darwin",
    env: HELPER_ENV,
    currentUid: 501,
    selfPid: 7,
    canonicalizePath: (path) => path,
    isProcessAlive: () => {
      const wasAlive = alive;
      alive = true;
      return wasAlive;
    },
    listProcesses: () => [
      orphan,
      { pid: 50, ppid: 1, uid: 501, command: "/usr/bin/curl https://example.invalid" },
    ],
    killProcess: (pid) => {
      reused.push(pid);
    },
  });
  assert.deepEqual(reused, [40]);

  const capped = reapOrphanedHelpers({
    platform: "darwin",
    env: HELPER_ENV,
    currentUid: 501,
    selfPid: 7,
    maxReap: 1,
    logger,
    canonicalizePath: (path) => path,
    isProcessAlive: () => false,
    listProcesses: () => [helperRow(40, 50), helperRow(41, 51)],
    killProcess: (pid) => {
      killed.push(pid);
    },
  });
  assert.deepEqual(capped.reaped, [40]);
  assert.match(warnings.at(-1), /hit per-run cap \(1\)/);

  const failed = reapOrphanedHelpers({
    platform: "darwin",
    env: HELPER_ENV,
    currentUid: 501,
    logger,
    listProcesses: () => {
      throw new Error("ps down");
    },
  });
  assert.deepEqual(failed, { scanned: 0, reaped: [] });
  assert.match(warnings.at(-1), /process listing failed: ps down/);
});

test("owner command classification rejects the helper and accepts ZCode", () => {
  assert.equal(isLikelyZCodeOwnerCommand("ZCode CUA Helper --socket /tmp/x"), false);
  assert.equal(isLikelyZCodeOwnerCommand("/Applications/ZCode.app/Contents/MacOS/ZCode"), true);
  assert.equal(isLikelyZCodeOwnerCommand("node /src/zcode/packages/services/src/node.ts"), true);
  assert.equal(isLikelyZCodeOwnerCommand("/usr/bin/curl"), false);
});

test("screen capture success requires a foreign non-uniform window", () => {
  const probe = {
    ok: true,
    status: "granted",
    probed: true,
    evidence: "foreign_window",
    content_evidence: "decoded_visible_non_uniform",
    probe_pid: 10,
    target_window_id: 20,
    target_owner_pid: 30,
    target_on_screen: true,
    target_bounds: [0, 0, 200, 200],
    png_width: 200,
    png_height: 200,
    candidate_count: 1,
    attempted_window_count: 1,
    sample_width: 2,
    sample_height: 2,
    sampled_pixel_count: 4,
    visible_pixel_count: 4,
    distinct_color_bucket_count: 3,
    dominant_color_pixel_count: 1,
    max_channel_range: 24,
    byte_length: 128,
  };
  assert.equal(isScreenCaptureProbeSuccess(probe), true);
  assert.equal(isScreenCaptureProbeSuccess(undefined), false);
  assert.equal(isScreenCaptureProbeSuccess({ ...probe, evidence: "self_window" }), false);
  assert.equal(isScreenCaptureProbeSuccess({ ...probe, target_owner_pid: 10 }), false);
  assert.equal(isScreenCaptureProbeSuccess({ ...probe, attempted_window_count: 4 }), false);
  assert.equal(isScreenCaptureProbeSuccess({ ...probe, png_width: 10 }), false);
  assert.equal(isScreenCaptureProbeSuccess({ ...probe, byte_length: 0 }), false);
  assert.equal(isScreenCaptureProbeSuccess({ ...probe, max_channel_range: 23 }), false);
});

test("helper stderr mirror keeps seven dated logs and rewrites lines", () => {
  const directory = mkdtempSync(join(tmpdir(), "zcode-helper-logs-"));
  for (let day = 1; day <= 9; day += 1) {
    writeFileSync(
      join(directory, `zcode-cua-helper-2026-09-${String(day).padStart(2, "0")}.jsonl`),
      "",
    );
  }
  writeFileSync(join(directory, "notes.txt"), "");
  pruneHelperLogs(directory);
  const names = readdirSync(directory).sort();
  assert.deepEqual(names, [
    "notes.txt",
    "zcode-cua-helper-2026-09-03.jsonl",
    "zcode-cua-helper-2026-09-04.jsonl",
    "zcode-cua-helper-2026-09-05.jsonl",
    "zcode-cua-helper-2026-09-06.jsonl",
    "zcode-cua-helper-2026-09-07.jsonl",
    "zcode-cua-helper-2026-09-08.jsonl",
    "zcode-cua-helper-2026-09-09.jsonl",
  ]);

  const lines = helperLogLines(
    '\n{"scope":"helper","level":"warn","event":"boot","evidence":{"ok":true},"extra":1}\n[broker] ready\n',
  )
    .trim()
    .split("\n");
  assert.equal(lines.length, 2);
  const structured = JSON.parse(lines[0]);
  assert.equal(structured.level, "warn");
  assert.equal(structured.event, "boot");
  assert.equal(structured.module, "helper");
  assert.deepEqual(structured.context, { ok: true });
  assert.equal(structured.extra, 1);
  const plain = JSON.parse(lines[1]);
  assert.equal(plain.event, "broker");
  assert.equal(plain.message, "ready");
  assert.equal(plain.module, "zcode-cua-helper");
});

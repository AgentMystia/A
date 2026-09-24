import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ZCodeTaskMeta } from "@zcode/shared";
import {
  getLegacyDeletedTaskSessionSnapshotPath,
  getLegacyTaskSessionSnapshotPath,
  setDataBaseDir,
} from "../src/paths.js";
import { parseLegacyTaskSessionFile } from "../src/session/legacyTaskSessionFile.js";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";
import { createZCodeTaskServiceAdapter } from "../src/zcode-agent/zcodeTaskServiceAdapter.js";

function legacyMeta(
  overrides: Partial<ZCodeTaskMeta> & Pick<ZCodeTaskMeta, "taskId" | "title">,
): ZCodeTaskMeta {
  return {
    traceId: `trace-${overrides.taskId}`,
    workspacePath: "/example/workspace",
    workspaceIdentity: "example-remote-workspace",
    mode: "build",
    provider: "glm",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

test("published legacy task snapshot is read-only when the protocol session is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-legacy-snapshot-"));
  setDataBaseDir(dir);
  const taskIndexRepo = new TaskIndexRepo(join(dir, "tasks.sqlite"));
  const created: string[] = [];
  const upstreamSessions: string[] = [];
  const disposable = () => ({ dispose() {} });
  type Options = Parameters<typeof createZCodeTaskServiceAdapter>[0];
  const service = createZCodeTaskServiceAdapter({
    taskIndexRepo,
    zcodeAgentService: {
      async resumeSession(input) {
        throw new Error(`Session not found: ${input.sessionId}`);
      },
      async createSession(input) {
        created.push(input.sessionId);
        throw new Error("upgrade failed");
      },
      onDynamicSessionEvent(input) {
        upstreamSessions.push(input.sessionId);
        return disposable;
      },
      disposeAll() {},
    } as unknown as Options["zcodeAgentService"],
    taskIndexSyncer: {
      onSessionTerminalEvent: disposable,
      onSessionReadyEvent: disposable,
      emitWorkspaceTaskListChanged() {},
      disposeAll() {},
    } as unknown as Options["taskIndexSyncer"],
  });

  async function writeLegacy(
    meta: ZCodeTaskMeta,
    content: string,
    kind: "live" | "deleted" = "live",
  ): Promise<void> {
    const path =
      kind === "live"
        ? getLegacyTaskSessionSnapshotPath(meta.workspacePath, meta.taskId, meta.workspaceIdentity)
        : getLegacyDeletedTaskSessionSnapshotPath(
            meta.workspacePath,
            meta.taskId,
            meta.workspaceIdentity,
          );
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify(
        parseLegacyTaskSessionFile({
          meta,
          messages: [{ id: "m1", role: "user", content, timestamp: 1 }],
        }),
      ),
    );
  }

  try {
    const plain = legacyMeta({ taskId: "plain-legacy", title: "File Title" });
    // JSON.stringify 会丢掉 undefined，文件里就不含 mode，才能走到发布包的 "default"。
    await writeLegacy(
      { ...plain, mode: undefined as unknown as ZCodeTaskMeta["mode"] },
      "from file",
    );
    const plainSnapshot = await service.getTaskSnapshot(plain);
    assert.equal(plainSnapshot?.meta.mode, "default");
    assert.equal(plainSnapshot?.meta.status, "completed");
    assert.equal(plainSnapshot?.messages[0]?.content, "from file");
    assert.equal(created.length, 0);
    assert.ok(plainSnapshot);
    service.onDynamicTaskEvent({
      taskId: plain.taskId,
      workspacePath: plain.workspacePath,
      workspaceIdentity: plain.workspaceIdentity,
    })(() => {});
    assert.deepEqual(upstreamSessions, []);

    const indexed = legacyMeta({ taskId: "indexed-legacy", title: "File Title" });
    await writeLegacy(indexed, "indexed body");
    await taskIndexRepo.syncTaskMeta({
      meta: { ...indexed, title: "Index Title", mode: "plan" },
    });
    const indexedSnapshot = await service.getTaskSnapshot(indexed);
    assert.equal(indexedSnapshot?.meta.title, "Index Title");
    assert.equal(indexedSnapshot?.messages[0]?.content, "indexed body");

    const deletedOnly = legacyMeta({ taskId: "deleted-legacy", title: "Deleted" });
    await writeLegacy(deletedOnly, "from deleted", "deleted");
    const deletedSnapshot = await service.getTaskSnapshot(deletedOnly);
    assert.equal(deletedSnapshot?.messages[0]?.content, "from deleted");

    const both = legacyMeta({ taskId: "both-legacy", title: "Both" });
    await writeLegacy(both, "from live");
    await writeLegacy(both, "from deleted", "deleted");
    const bothSnapshot = await service.getTaskSnapshot(both);
    assert.equal(bothSnapshot?.messages[0]?.content, "from live");

    const claude = legacyMeta({
      taskId: "claude-legacy",
      title: "Claude",
      migrationSource: "claudeCode",
    });
    await writeLegacy(claude, "claude body");
    const claudeSnapshot = await service.getTaskSnapshot(claude);
    assert.deepEqual(created, ["claude-legacy"]);
    assert.equal(claudeSnapshot?.messages[0]?.content, "claude body");

    const resumed = await service.resumeTask({
      ...both,
      automationId: "auto-1",
      offPeakTaskId: "off-1",
    });
    assert.equal(resumed.cronAutomationId, "auto-1");
    assert.equal(resumed.offPeakTaskId, "off-1");

    const broken = legacyMeta({ taskId: "broken-legacy", title: "Broken" });
    const brokenPath = getLegacyTaskSessionSnapshotPath(
      broken.workspacePath,
      broken.taskId,
      broken.workspaceIdentity,
    );
    await mkdir(dirname(brokenPath), { recursive: true });
    await writeFile(brokenPath, "{");
    await assert.rejects(service.getTaskSnapshot(broken), /Session not found: broken-legacy/);

    service.onDynamicTaskEvent({
      taskId: "live-session",
      workspacePath: plain.workspacePath,
      workspaceIdentity: plain.workspaceIdentity,
    })(() => {});
    assert.deepEqual(upstreamSessions, ["live-session"]);
  } finally {
    service.disposeAll();
    taskIndexRepo.close();
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

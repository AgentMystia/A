import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";

const meta = {
  taskId: "fallback-task",
  traceId: "trace-fallback",
  title: "Fallback",
  workspacePath: "/example/workspace",
  createdAt: 1,
  updatedAt: 2,
  mode: "build" as const,
  provider: "glm" as const,
};

test("invalid task meta_json passes the provider column through", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-task-provider-"));
  const path = join(dir, "tasks.sqlite");
  const repo = new TaskIndexRepo(path);
  try {
    await repo.syncTaskMeta({ meta });
    repo.close();
    const database = new DatabaseSync(path);
    try {
      database
        .prepare("UPDATE tasks SET meta_json = ?, provider = ? WHERE task_id = ?")
        .run("{", "claude", meta.taskId);
    } finally {
      database.close();
    }
    const read = await repo.getTaskMeta({
      workspacePath: meta.workspacePath,
      taskId: meta.taskId,
    });
    assert.equal(read?.provider, "claude");
    assert.equal(read?.taskId, meta.taskId);
    assert.equal(read?.traceId, `zcode-${meta.taskId}`);
  } finally {
    repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});

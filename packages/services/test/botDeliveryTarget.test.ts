import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveWorkspaceKey, type ZCodeBotDeliveryTarget } from "@zcode/shared";
import { resolveAutomationBotDeliveryTarget } from "../src/bots/botsHostHelpers.js";
import { AutomationRepo } from "../src/session/automationRepo.js";
import {
  parseStoredBotDeliveryTarget,
  watchCronRunBotDelivery,
} from "../src/session/botDeliveryTarget.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const target: ZCodeBotDeliveryTarget = {
  provider: "feishu",
  botId: "bot-1",
  providerUserId: "ou_user",
  chatType: "private",
};

test("parseStoredBotDeliveryTarget 只接受发布包 schema", () => {
  assert.deepEqual(parseStoredBotDeliveryTarget(JSON.stringify(target)), target);
  assert.equal(parseStoredBotDeliveryTarget("{"), undefined);
  assert.equal(
    parseStoredBotDeliveryTarget(
      JSON.stringify({ provider: "feishu", botId: "bot-1", providerUserId: "ou_user" }),
    ),
    undefined,
  );
});

test("resolveAutomationBotDeliveryTarget 缺少 chatType 时不发送", () => {
  assert.deepEqual(
    resolveAutomationBotDeliveryTarget({
      provider: "weixin",
      botId: "bot-1",
      providerUserId: "openid",
      chatId: " chat-1 ",
      chatType: "group",
    }),
    {
      provider: "weixin",
      botId: "bot-1",
      providerUserId: "chat-1",
      chatType: "group",
    },
  );
  assert.equal(
    resolveAutomationBotDeliveryTarget({
      provider: "feishu",
      botId: "bot-1",
      providerUserId: "ou_user",
    }),
    undefined,
  );
  assert.equal(
    resolveAutomationBotDeliveryTarget({
      provider: "webhook",
      botId: "bot-1",
      providerUserId: "hook",
      chatType: "private",
    }),
    undefined,
  );
});

test("automation create 写入 bot_delivery_target，公开对象与 update 不拥有它", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bot-delivery-"));
  const dbPath = join(dir, "tasks-index.sqlite");
  const repo = new AutomationRepo(dbPath);
  try {
    const created = await repo.create(
      {
        title: "delivery",
        cronExpr: "0 * * * *",
        prompt: "ping",
        workspacePath: "/tmp/ws",
        recurring: true,
        botDeliveryTarget: target,
      },
      { nextRunAt: 1 },
    );
    assert.equal("botDeliveryTarget" in created, false);
    const workspaceKey = resolveWorkspaceKey({ workspacePath: "/tmp/ws" });
    assert.deepEqual(await repo.getBotDeliveryTarget(created.automationId, workspaceKey), target);
    const updated = await repo.update(
      created.automationId,
      { title: "renamed" },
      undefined,
      workspaceKey,
    );
    assert.equal(updated?.title, "renamed");
    assert.equal("botDeliveryTarget" in (updated ?? {}), false);
    assert.deepEqual(await repo.getBotDeliveryTarget(created.automationId, workspaceKey), target);
    repo.close();

    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE automations SET bot_delivery_target = @raw WHERE automation_id = @id").run({
      raw: "{",
      id: created.automationId,
    });
    db.close();
    const reopened = new AutomationRepo(dbPath);
    assert.equal(
      await reopened.getBotDeliveryTarget(created.automationId, workspaceKey),
      undefined,
    );
    reopened.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("watchCronRunBotDelivery 只在目标存在时订阅", async () => {
  const calls: unknown[] = [];
  const watched = await watchCronRunBotDelivery({
    automationId: "automation-1",
    workspaceKey: "ws",
    workspacePath: "/tmp/ws",
    workspaceIdentity: "remote:ssh:1",
    taskId: "task-1",
    repo: { getBotDeliveryTarget: async () => target },
    botsService: {
      watchAutomationRun: async (watch) => {
        calls.push(watch);
      },
    },
  });
  assert.equal(watched, true);
  assert.deepEqual(calls, [
    {
      target,
      taskId: "task-1",
      workspacePath: "/tmp/ws",
      workspaceIdentity: "remote:ssh:1",
    },
  ]);

  const skipped = await watchCronRunBotDelivery({
    automationId: "automation-1",
    workspaceKey: "ws",
    workspacePath: "/tmp/ws",
    taskId: "task-1",
    repo: { getBotDeliveryTarget: async () => undefined },
    botsService: {
      watchAutomationRun: async () => {
        throw new Error("should not subscribe");
      },
    },
  });
  assert.equal(skipped, false);
});

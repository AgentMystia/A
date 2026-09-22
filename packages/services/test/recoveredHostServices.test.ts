import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BOT_BIND_CODE_TTL_MS,
  DEFAULT_BOT_COMMAND_POLICY,
  readServerTimeMilliseconds,
  type ApiClient,
  type AppSettings,
  type BotConfigEntry,
  type BotInboundMessage,
} from "@zcode/shared";
import type { ICredentialService } from "../src/credential/credential.js";
import { createBotsService } from "../src/bots/botsService.js";
import { BOT_CONFIG_V3_FILE_NAME, BOT_STATE_V3_FILE_NAME } from "../src/bots/botsPaths.js";
import { createCodingPlanSubscriptionService } from "../src/coding-plan-subscription/codingPlanSubscriptionService.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";

function memoryCredentials(): ICredentialService {
  const values = new Map<string, string>();
  return {
    load: async (key) => values.get(key) ?? null,
    save: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
  };
}

function webhookBot(id: string, extras: Partial<BotConfigEntry> = {}): BotConfigEntry {
  return {
    id,
    name: "Webhook",
    provider: "webhook",
    enabled: true,
    allowedWorkspaces: ["*"],
    allowedCommands: DEFAULT_BOT_COMMAND_POLICY,
    currentOptions: {},
    replyMode: "assistant_changes",
    ...extras,
  };
}

function inbound(
  botId: string,
  text: string,
  providerUserId = "user-1",
): BotInboundMessage {
  return {
    botId,
    text,
    actor: {
      provider: "webhook",
      botId,
      providerUserId,
      chatType: "private",
      chatId: "chat-1",
    },
  };
}

test("bots persist v3 files, bind/help/modeLocked, and unique /new enters draft", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-bots-"));
  setDataBaseDir(dir);
  await mkdir(getAppConfigDir(), { recursive: true });
  const service = createBotsService({
    runStartupBackgroundTasks: false,
    credentialService: memoryCredentials(),
    settingService: {
      get: async () =>
        ({
          locale: "zh-CN",
          lastWorkspaceSession: [{ kind: "local", workspacePath: "/tmp/ws" }],
        }) as AppSettings,
    },
  });
  try {
    assert.deepEqual(await service.getUserConfigOptions(), []);
    await service.saveBot({ bot: webhookBot("bot-1") });
    await service.getConfig();
    await service.getBotStates();
    const configPath = join(getAppConfigDir(), BOT_CONFIG_V3_FILE_NAME);
    const statePath = join(getAppConfigDir(), BOT_STATE_V3_FILE_NAME);
    assert.equal(JSON.parse(await readFile(configPath, "utf8")).version, 3);
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).version, 3);

    const unbound = await service.handleInboundMessage(inbound("bot-1", "/help"));
    assert.match(unbound[0]?.text ?? "", /未绑定/);

    const bind = await service.createBindCode({ botId: "bot-1" });
    assert.match(bind.code, /^[0-9A-F]{6}$/u);
    assert.ok(bind.expiresAt - Date.now() <= BOT_BIND_CODE_TTL_MS + 50);

    const bound = await service.handleInboundMessage(inbound("bot-1", `/bind ${bind.code}`));
    assert.match(bound[0]?.text ?? "", /绑定成功/);

    const help = await service.handleInboundMessage(inbound("bot-1", "/help"));
    assert.match(help[0]?.text ?? "", /ZCode 机器人命令/);

    const locked = await service.handleInboundMessage(inbound("bot-1", "/mode"));
    assert.match(locked[0]?.text ?? "", /yolo/);

    const created = await service.handleInboundMessage(inbound("bot-1", "/new"));
    assert.match(created[0]?.text ?? "", /草稿|工作区/);

    const discord = await service.saveBot({
      bot: webhookBot("bot-discord", { name: "Discord", provider: "discord" }),
    });
    const reserved = await service.testBot(discord.id);
    assert.equal(reserved.ok, false);
    assert.equal(reserved.message, "discord is reserved for a future version.");
  } finally {
    await service.disposeAllAndWait();
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("manual claim without JWT returns 401 and does not call the API", async () => {
  let called = false;
  const apiClient: ApiClient = {
    request: async () => {
      called = true;
      throw new Error("api should not be called");
    },
  };
  const service = createCodingPlanSubscriptionService({
    apiClient,
    credentialService: memoryCredentials(),
  });
  const result = await service.claimManualPlan({
    planId: "plan-1",
    captchaVerifyParam: "captcha",
  });
  assert.equal(called, false);
  assert.deepEqual(result, { success: false, code: 401, message: "" });
});

test("readServerTimeMilliseconds multiplies unique second values by 1000", () => {
  assert.equal(readServerTimeMilliseconds(1_700_000_000), 1_700_000_000_000);
  assert.equal(readServerTimeMilliseconds("1"), undefined);
  assert.equal(readServerTimeMilliseconds(-1), undefined);
});

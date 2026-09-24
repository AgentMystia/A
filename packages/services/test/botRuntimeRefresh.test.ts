import assert from "node:assert/strict";
import test from "node:test";

import type { BotsConfig } from "@zcode/shared";
import { createFeishuChannelRuntime } from "../src/bots/botsFeishuRuntime.js";
import { createTelegramChannelRuntime } from "../src/bots/botsTelegramRuntime.js";
import { createWeixinChannelRuntime } from "../src/bots/botsWeixinRuntime.js";
import type { BotProvider } from "../src/bots/botsTypes.js";
import type { ServiceLogger } from "../src/logger/serviceLogger.js";

const emptyConfig: BotsConfig = { version: 3, bots: [] };

const logger: ServiceLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

test("channel runtimes skip scheduled refresh when background tasks are off", async () => {
  let reads = 0;
  const readConfig = async () => {
    reads += 1;
    return emptyConfig;
  };
  const shared = {
    runBackgroundTasks: false,
    credentialService: { load: async () => null },
    logger,
    statusSink: { getRuntimeStatus: () => undefined, setRuntimeStatus: () => undefined },
    ensureBotStorageMigrated: async () => undefined,
    readConfig,
  };
  const telegram = createTelegramChannelRuntime({
    ...shared,
    telegramProvider: { syncCommands: async () => undefined } as BotProvider,
    readTelegramOffset: async () => undefined,
    writeTelegramOffset: async () => undefined,
    processProviderCallback: async () => ({ ok: true, replies: [] }),
  });
  const weixin = createWeixinChannelRuntime({
    ...shared,
    readWeixinGetUpdatesBuf: async () => undefined,
    writeWeixinGetUpdatesBuf: async () => undefined,
    processProviderCallback: async () => ({ ok: true, replies: [] }),
  });
  const feishu = createFeishuChannelRuntime({
    ...shared,
    summarizeCallbackPayload: () => "",
    processProviderCallback: async () => ({ ok: true, replies: [] }),
  });

  telegram.scheduleRefresh(emptyConfig);
  weixin.scheduleRefresh(emptyConfig);
  feishu.scheduleRefresh(emptyConfig);
  await Promise.resolve();
  assert.equal(reads, 0);

  await telegram.refresh(emptyConfig);
  await weixin.refresh(emptyConfig);
  await feishu.refresh(emptyConfig);
  assert.equal(reads, 0);
  await telegram.dispose();
  await weixin.dispose();
  await feishu.dispose();
});

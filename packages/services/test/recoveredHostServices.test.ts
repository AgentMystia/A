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

function inbound(botId: string, text: string, providerUserId = "user-1"): BotInboundMessage {
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

test("unique remaining bots helpers match published keepNames", async () => {
  const {
    formatAttachmentSize,
    formatAttachmentRejectedReason,
    sanitizeAttachmentFilename,
    prepareBotMessageContent,
  } = await import("../src/bots/botsAttachments.js");
  const { isSessionExpiredError, formatUserFacingBotError } =
    await import("../src/bots/botsErrors.js");
  const { isTerminalTaskMeta } = await import("../src/bots/botsTaskMeta.js");
  const {
    normalizeBotElicitationQuestions,
    readBotElicitationRenderContext,
    formatBotElicitationTitle,
  } = await import("../src/bots/botsElicitationBuild.js");

  assert.equal(sanitizeAttachmentFilename("a/b:c"), "a_b_c");
  assert.equal(formatAttachmentSize(2048), "2KB");
  assert.equal(
    formatAttachmentRejectedReason(new Error("file.png exceeds 5MB."), "zh-CN"),
    "附件超过 5MB，请压缩后重新发送。",
  );
  assert.equal(isSessionExpiredError(new Error("Session not found: abc")), true);
  assert.match(formatUserFacingBotError(new Error("Session is not active: x"), "zh-CN"), /新任务/);
  assert.equal(isTerminalTaskMeta({ status: "completed" } as never, "task_complete"), true);
  assert.equal(isTerminalTaskMeta({ status: "error" } as never, "task_error"), true);

  const questions = normalizeBotElicitationQuestions(
    {
      type: "elicitation_request",
      taskId: "t1",
      traceId: "tr",
      requestId: "r1",
      message: "pick",
      options: [{ value: "a", label: "A" }],
      schema: { interaction: "plan_approval", plan: "do it" },
    },
    "zh-CN",
  );
  assert.equal(questions[0]?.options[0]?.value, "approve");
  assert.equal(
    readBotElicitationRenderContext({
      type: "elicitation_request",
      taskId: "t1",
      traceId: "tr",
      requestId: "r1",
      message: "pick",
      options: [],
      schema: { interaction: "plan_approval", plan: "do it" },
    })?.kind,
    "plan_approval",
  );
  assert.match(
    formatBotElicitationTitle(
      {
        taskId: "t1",
        requestId: "r1",
        runId: "tr",
        currentQuestionIndex: 0,
        questions,
        answers: {},
        renderContext: { kind: "plan_approval", plan: "do it" },
      },
      "zh-CN",
    ),
    /实施计划/,
  );

  const prepared = await prepareBotMessageContent(
    webhookBot("bot-1"),
    inbound("bot-1", "hello"),
    "zh-CN",
    { webhook: null },
  );
  assert.equal(prepared.content, "hello");
  assert.deepEqual(prepared.zcodeAttachments, []);
});

test("published bot task channels and config keepNames", async () => {
  const {
    BOT_TASK_LIST_CHANNEL,
    BOT_TASK_STREAM_CHANNEL,
    broadcastTaskListChange,
    broadcastTaskStreamEvent,
  } = await import("../src/bots/botsBroadcast.js");
  const {
    listProviderConfigOptionsForActiveTask,
    listUserConfigOptions,
    readCurrentActiveTaskMode,
  } = await import("../src/bots/botsDraft.js");
  const sent: Array<{ channel: string; payload: { event?: unknown; taskId?: string } }> = [];
  const runtime = {
    broadcastService: {
      send: async (message: { channel: string; payload: { event?: unknown; taskId?: string } }) => {
        sent.push(message);
      },
    },
  };
  assert.equal(BOT_TASK_LIST_CHANNEL, "bots:task");
  assert.equal(BOT_TASK_STREAM_CHANNEL, "bots:task-stream");
  await broadcastTaskListChange(runtime, { workspacePath: "/tmp/ws" }, "task-1", "created", {
    task: { taskId: "task-1" },
  });
  await broadcastTaskStreamEvent(
    runtime,
    { workspacePath: "/tmp/ws" },
    {
      type: "task_complete",
      taskId: "task-1",
      traceId: "trace-1",
    },
  );
  assert.equal(sent[0]?.channel, "bots:task");
  assert.equal(sent[0]?.payload.event, "created");
  assert.equal(sent[1]?.channel, "bots:task-stream");
  assert.equal(sent[1]?.payload.taskId, "task-1");
  assert.deepEqual(await listUserConfigOptions({ workspacePath: "/tmp/ws", provider: "glm" }), []);
  assert.deepEqual(
    await listProviderConfigOptionsForActiveTask({ workspacePath: "/tmp/ws" }, "glm"),
    [],
  );
  assert.equal(readCurrentActiveTaskMode({ mode: "yolo" }, []), "yolo");
  assert.equal(
    readCurrentActiveTaskMode({ mode: "yolo" }, [
      { id: "mode", name: "Mode", type: "select", currentValue: "plan" },
    ]),
    "plan",
  );
});

test("published assistant reply blocks flush on tool events and clear live progress", async () => {
  const { createAssistantReplyBlocks, formatBotAssistantReplyBlocks } =
    await import("../src/bots/botsReplyBlocks.js");
  const { updateLiveStatusProgress, formatTaskRunningDuration, readTaskWorkedDurationMs } =
    await import("../src/bots/botsStatusProgress.js");
  const { extractBotAssistantResponseMessages, formatBotToolCallSummaryLine } =
    await import("../src/bots/botsReplyFormat.js");
  const { handlePublishedTaskStreamEvent } = await import("../src/bots/botsTaskStreamEvents.js");
  const { createPublishedTaskStreamSession } = await import("../src/bots/botsStreamingCardSync.js");

  assert.deepEqual(extractBotAssistantResponseMessages("a\r\nb", false), {
    messages: [],
    rest: "a\nb",
  });
  assert.equal(formatTaskRunningDuration(0), "0s");
  assert.equal(formatTaskRunningDuration(90_061_000), "1d 1h 1m 1s");
  assert.equal(
    readTaskWorkedDurationMs({ messages: [] }, { status: "completed", createdAt: 1, updatedAt: 6 }),
    5,
  );
  const parts = [
    { type: "content" as const, content: "old" },
    { type: "tool-call" as const, toolId: "tool-1" },
    { type: "content" as const, content: "new" },
  ];
  const toolCalls = new Map([
    [
      "tool-1",
      {
        toolId: "tool-1",
        title: "List",
        kind: "bash",
        status: "completed",
        input: { command: "ls" },
      },
    ],
  ]);
  assert.deepEqual(createAssistantReplyBlocks(parts, toolCalls, "summary_changes", null), [
    { type: "content", content: "new" },
  ]);
  const toolBlocks = createAssistantReplyBlocks(
    parts,
    toolCalls,
    "assistant_toolcalls_changes",
    null,
  );
  assert.equal(
    toolBlocks.some((block) => block.type === "tool-call"),
    true,
  );
  assert.match(
    formatBotAssistantReplyBlocks(toolBlocks, { locale: "zh-CN" }).join("\n"),
    /工具调用/,
  );
  assert.equal(
    formatBotToolCallSummaryLine(
      { toolId: "t", title: "List", kind: "bash", status: "completed" },
      { locale: "en-US" },
    ),
    "- Completed \u00b7 List",
  );

  const progress = new Map();
  updateLiveStatusProgress(progress, {
    type: "agent_message_chunk",
    taskId: "task-1",
    traceId: "trace-1",
    content: " hello ",
  } as never);
  updateLiveStatusProgress(progress, {
    type: "agent_message_chunk",
    taskId: "task-1",
    traceId: "trace-1",
    content: "world",
  } as never);
  assert.equal(progress.get("task-1")?.text, "helloworld");

  const sent: string[] = [];
  const runtime = {
    liveStatusProgress: progress,
    streamingCardAborts: new Set(),
    runningTasks: new Set(["task-1"]),
    streamSubs: new Map([["key", { dispose() {} }]]),
    stopTyping() {},
    transientCards: new Map(),
    providers: {},
    logger: { warn() {}, info() {}, debug() {} },
    async readMessageLocale() {
      return "en-US" as const;
    },
    async sendOutbound(_bot: unknown, outbound: { text: string }) {
      sent.push(outbound.text);
    },
    async persistContext(context: unknown) {
      return context;
    },
    replies() {
      return [];
    },
  };
  const session = createPublishedTaskStreamSession();
  const bot = webhookBot("bot-1");
  const actor = inbound("bot-1", "hello").actor;
  const context = {
    botId: "bot-1",
    workspacePath: "/tmp/ws",
    mode: "task" as const,
    activeTaskId: "task-1",
    updatedAt: 1,
  };
  const taskService = {
    async getTaskSnapshot() {
      return { messages: [], fileChanges: [] };
    },
  };
  const chunk = {
    type: "agent_message_chunk" as const,
    taskId: "task-1",
    traceId: "trace-1",
    content: "Hello",
  };
  await handlePublishedTaskStreamEvent(
    runtime as never,
    bot,
    actor,
    context,
    "key",
    session,
    taskService as never,
    chunk as never,
    false,
  );
  assert.deepEqual(sent, []);
  await handlePublishedTaskStreamEvent(
    runtime as never,
    bot,
    actor,
    context,
    "key",
    session,
    taskService as never,
    {
      type: "tool_call",
      taskId: "task-1",
      traceId: "trace-1",
      toolId: "tool-1",
      kind: "bash",
      title: "List",
      input: {},
      raw: {},
    } as never,
    false,
  );
  assert.deepEqual(sent, ["Hello"]);
  await handlePublishedTaskStreamEvent(
    runtime as never,
    bot,
    actor,
    context,
    "key",
    session,
    taskService as never,
    { type: "task_complete", taskId: "task-1", traceId: "trace-1" } as never,
    false,
  );
  assert.equal(progress.has("task-1"), false);
  assert.deepEqual(sent, ["Hello"]);
});

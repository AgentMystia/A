import assert from "node:assert/strict";
import test from "node:test";
import { buildFeishuElicitationCardPayload } from "../src/bots/botsFeishuElicitationCard.js";
import { buildFeishuStreamingCardPayload } from "../src/bots/botsFeishuCards.js";
import { resolveFeishuAppDisplayName } from "../src/bots/botsFeishuHttp.js";
import {
  readFeishuAttachment,
  readFeishuCardAction,
  readFeishuTextMessage,
} from "../src/bots/botsFeishuParse.js";
import { readWeixinAttachments } from "../src/bots/botsWeixinParse.js";

test("published feishu elicitation card uses option commands and form prefix", () => {
  const card = buildFeishuElicitationCardPayload({
    botId: "bot",
    provider: "feishu",
    providerUserId: "ou_user",
    locale: "zh-CN",
    text: "ask",
    selection: {
      id: "elicitation-1-0",
      token: "abc123abc123",
      title: "ask",
      action: "elicitation.respond",
      options: [],
      cancelLabel: "取消",
    },
    elicitation: {
      requestId: "req",
      taskId: "task",
      runId: "run",
      currentQuestionIndex: 0,
      status: "pending",
      questions: [
        {
          question: "Pick one",
          header: "Pick one",
          options: [{ value: "yes", label: "Yes" }],
        },
      ],
      answers: { "0": ["yes"] },
      expandedCustomAnswerQuestionIndexes: [0],
    },
  });
  const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
  const choice = elements.find((element) => {
    const text = element.text as { content?: string } | undefined;
    return element.tag === "button" && text?.content?.includes("Yes") === true;
  });
  const behaviors = choice?.behaviors as Array<{ value: { command: string } }>;
  assert.equal(behaviors?.[0]?.value.command, "/elicitation abc123abc123 yes");
  const form = elements.find((element) => element.tag === "form");
  assert.ok(form);
  const submit = (form.elements as Array<Record<string, unknown>>).find(
    (element) => element.tag === "button",
  );
  const submitBehaviors = submit?.behaviors as Array<{ value: { command: string } }>;
  assert.equal(submitBehaviors?.[0]?.value.command, "/elicitation abc123abc123 __form__:");
});

test("published feishu card callback rewrites form answers", () => {
  const message = readFeishuCardAction("bot", {
    header: { event_id: "evt-1" },
    event: {
      operator: { operator_id: { open_id: "ou_user" } },
      action: {
        value: { command: "/elicitation abc123abc123 __form__:" },
        form_value: { answer: "custom" },
      },
    },
  });
  assert.equal(
    message?.text,
    `/elicitation abc123abc123 __form__:${encodeURIComponent(JSON.stringify("custom"))}`,
  );
  assert.equal(message?.actor.providerMessageId, "evt-1");
});

test("published feishu post text and media attachment kinds", () => {
  const message = readFeishuTextMessage("bot", {
    event: {
      message: {
        message_type: "post",
        message_id: "om_1",
        content: JSON.stringify({
          zh_cn: {
            title: "标题",
            content: [
              [
                { tag: "text", text: "正文" },
                { tag: "a", text: "链接", href: "https://example.com" },
              ],
            ],
          },
        }),
      },
      sender: { sender_id: { union_id: "on_user" } },
    },
  });
  assert.equal(message?.text, "标题\n正文链接 https://example.com");
  assert.equal(message?.actor.providerUserId, "on_user");
  assert.deepEqual(readFeishuAttachment("media", { media_key: "filekey1", size: 12 }), {
    id: "filekey1",
    kind: "video",
    filename: "media-filekey1",
    mimeType: "video/mp4",
    sizeBytes: 12,
    providerFileId: "filekey1",
  });
});

test("published streaming tool panel and app display name fallback", () => {
  const card = buildFeishuStreamingCardPayload({
    providerUserId: "ou_user",
    locale: "zh-CN",
    status: "running",
    blocks: [{ type: "tools", summaries: [" - Completed · List"] }],
  });
  const panel = (card.body as { elements: Array<Record<string, unknown>> }).elements.find(
    (element) => element.tag === "collapsible_panel",
  );
  assert.ok(panel);
  assert.equal(panel.background_color, "grey-50");
  assert.equal((panel.header as { title: { content: string } }).title.content, "🛠️ 工具摘要 (1)");
  assert.equal(
    resolveFeishuAppDisplayName({
      data: { app: { primary_language: "zh_cn", i18n: [{ i18n_key: "zh_cn", name: " 机器人 " }] } },
    }),
    "机器人",
  );
});

test("published weixin direct attachment normalizes provider fields", () => {
  assert.deepEqual(
    readWeixinAttachments({
      attachments: [
        {
          kind: "file",
          file_id: "9",
          mime_type: "text/plain",
          providerMetadata: { weixinAesKey: "k", extra: 1 },
        },
      ],
    }),
    [
      {
        id: "weixin-1",
        kind: "file",
        filename: "weixin-1.file",
        mimeType: "text/plain",
        providerFileId: "9",
        providerMetadata: { weixinAesKey: "k" },
      },
    ],
  );
});

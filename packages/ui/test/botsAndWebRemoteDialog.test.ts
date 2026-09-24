import assert from "node:assert/strict";
import test from "node:test";

import { BOT_BIND_CODE_TTL_MS } from "@zcode/shared";

import {
  allowsAllWorkspaces,
  bindCodeRequest,
  bindCountdownLabel,
  botChannelRegionTag,
  botDisplayName,
  createBotDraft,
  currentReplyGranularity,
  replyGranularityOptions,
  runtimeDotClass,
  runtimeErrorCode,
  runtimeStatusText,
  selectOrCreateBot,
  WEB_REMOTE_BOT_CHANNELS,
} from "../src/bots/botsDialogModel.js";
import {
  sameWebRemoteControlDialogStatus,
  sameWebRemoteControlPollStatus,
  webRemoteControlFailureLabel,
  webRemoteControlHasConnectedPhone,
  webRemoteControlSessionMatchesWorkspace,
} from "../src/web-remote/webRemoteControlFormat.js";

const formatMessage = (descriptor: { id: string }) => descriptor.id;

test("bot dialog helpers follow the published catalog and bind TTL", () => {
  assert.equal(BOT_BIND_CODE_TTL_MS, 30_000);
  assert.deepEqual(bindCodeRequest({ id: "bot-1", allowedWorkspaces: ["*"] }), {
    botId: "bot-1",
    ttlMs: 30_000,
    allowedWorkspaces: ["*"],
  });
  assert.equal(allowsAllWorkspaces([]), true);
  assert.equal(allowsAllWorkspaces(["*"]), true);
  assert.equal(allowsAllWorkspaces(["workspace-a"]), false);
  assert.equal(botDisplayName("  ", "New bot"), "New bot");
  assert.equal(botChannelRegionTag("lark"), "login.oauth.regionTag.zai");
  assert.equal(botChannelRegionTag("feishu"), "login.oauth.regionTag.bigmodel");
  assert.equal(botChannelRegionTag("telegram"), null);
  assert.equal(runtimeErrorCode("request failed 99991503 at gateway"), "99991503");
  assert.equal(runtimeErrorCode("code 123456"), undefined);
  assert.equal(bindCountdownLabel(1500), "2s");
  assert.deepEqual(
    WEB_REMOTE_BOT_CHANNELS.map((channel) => channel.provider),
    ["weixin", "feishu", "lark", "telegram"],
  );
  const draft = createBotDraft("feishu");
  assert.equal(draft.replyMode, "streaming_card");
  assert.deepEqual(draft.allowedWorkspaces, ["*"]);
  assert.equal(draft.provider, "feishu");
  assert.deepEqual(
    replyGranularityOptions("telegram").map((option) => option.id),
    ["assistant_changes", "assistant_toolcalls_changes", "summary_changes"],
  );
  assert.equal(currentReplyGranularity("telegram", "streaming_card").id, "assistant_changes");
  assert.equal(selectOrCreateBot([draft], "feishu").mode, "select");
  assert.deepEqual(selectOrCreateBot([draft], "weixin"), { mode: "create", provider: "weixin" });
  assert.equal(
    runtimeDotClass({ botId: "b", provider: "telegram", status: "error" }, true),
    "bg-destructive",
  );
  assert.equal(
    runtimeStatusText(
      { botId: "b", provider: "telegram", status: "polling", messageId: "bots.connected" },
      true,
      (id) => formatMessage({ id }),
    ),
    "bots.connected",
  );
});

test("web remote failure and session reuse match the published dialog", () => {
  assert.equal(
    webRemoteControlFailureLabel(
      { reason: "session-conflict", message: "device was kicked" },
      formatMessage,
    ),
    "webRemoteControl.failure.kicked",
  );
  assert.equal(
    webRemoteControlFailureLabel(
      { reason: "session-conflict", message: "other phone" },
      formatMessage,
    ),
    "webRemoteControl.failure.sessionConflict",
  );
  assert.equal(
    webRemoteControlFailureLabel({ reason: "not-a-reason", message: "x" }, formatMessage),
    null,
  );
  const live = {
    status: "active" as const,
    workspacePath: "/repo",
    workspaceIdentity: " remote-id ",
    remoteSessionId: "session-1",
    sessionId: "window-1",
    mobileConnected: true,
  };
  assert.equal(
    webRemoteControlSessionMatchesWorkspace(live, "/repo", "remote-id", "session-1"),
    true,
  );
  assert.equal(
    webRemoteControlSessionMatchesWorkspace(live, "/other", "remote-id", "session-1"),
    true,
  );
  assert.equal(
    webRemoteControlSessionMatchesWorkspace(live, "/repo", "other-id", "session-1"),
    false,
  );
  assert.equal(webRemoteControlHasConnectedPhone({ ...live, status: "idle" }), false);
  assert.equal(webRemoteControlHasConnectedPhone(live), true);
  const next = { ...live, mobileViewState: { activeWorkspaceKey: "k", updatedAt: 1 } };
  assert.equal(sameWebRemoteControlPollStatus(live, live), true);
  assert.equal(sameWebRemoteControlPollStatus(live, next), false);
  assert.equal(sameWebRemoteControlDialogStatus(live, { ...live, qrUrl: "https://qr" }), false);
});

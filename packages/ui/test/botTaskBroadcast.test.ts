import assert from "node:assert/strict";
import test from "node:test";
import type { ZCodeTaskMeta } from "@zcode/shared";

import {
  botTaskListRuntimeStatus,
  isCompactOrCompressPrompt,
  mergeBotTaskUsage,
  readBotTaskListPayload,
  readBotTaskStreamPayload,
  shouldBumpBotTaskList,
  shouldProjectBotTaskStream,
} from "../src/bots/botTaskBroadcastPayload.js";
import { handleBotTaskBroadcastMessage } from "../src/bots/botTaskBroadcast.js";
import type { WindowTabState } from "../src/store/tabStore.js";
import { useZCodeSessionStore } from "../src/store/zcodeSessionStore.js";
import { useTaskQueryCacheStore } from "../src/store/taskQueryCacheStore.js";

const WORKSPACE_PATH = "/tmp/bot-task-broadcast-workspace";

function task(taskId: string): ZCodeTaskMeta {
  return {
    taskId,
    traceId: "trace",
    title: taskId,
    workspacePath: WORKSPACE_PATH,
    createdAt: 1,
    updatedAt: 2,
    mode: "act",
  } as ZCodeTaskMeta;
}

function workspaceTabs(): WindowTabState[] {
  return [
    {
      id: "tab-bot-broadcast",
      kind: "workspace",
      workspacePath: WORKSPACE_PATH,
      label: "workspace",
    },
  ];
}

function resetStores(): void {
  useZCodeSessionStore.setState({ workspaces: {} });
  useTaskQueryCacheStore.setState({
    resultsByQueryKey: {},
    taskMetaByEntityKey: {},
    taskUnreadOverlayByEntityKey: {},
  });
}

test("bot task list runtime status matches the published event map", () => {
  assert.equal(botTaskListRuntimeStatus("created"), "creating");
  assert.equal(botTaskListRuntimeStatus("completed"), "completed");
  assert.equal(botTaskListRuntimeStatus("error"), "failed");
  assert.equal(botTaskListRuntimeStatus("prompt_sent"), "streaming");
  assert.equal(botTaskListRuntimeStatus("permission_resolved"), "streaming");
  assert.equal(botTaskListRuntimeStatus("updated"), "ready");
  assert.equal(botTaskListRuntimeStatus("ignored"), undefined);
});

test("bot task list bump keeps the published created short-circuit", () => {
  assert.equal(shouldBumpBotTaskList("created", true), true);
  assert.equal(shouldBumpBotTaskList("updated", true), false);
  assert.equal(shouldBumpBotTaskList("updated", false), true);
  assert.equal(shouldBumpBotTaskList("prompt_sent", false), false);
});

test("bot task stream projection skips the active task without workspace identity", () => {
  assert.equal(
    shouldProjectBotTaskStream({
      activeTaskId: "task-1",
      taskId: "task-1",
      workspaceIdentity: "  ",
    }),
    false,
  );
  assert.equal(
    shouldProjectBotTaskStream({
      activeTaskId: "task-1",
      taskId: "task-1",
      workspaceIdentity: "remote:workspace",
    }),
    true,
  );
  assert.equal(
    shouldProjectBotTaskStream({
      activeTaskId: "task-1",
      taskId: "task-2",
    }),
    true,
  );
});

test("compact prompts and usage merge follow the published usage_update rules", () => {
  assert.equal(isCompactOrCompressPrompt(" /compact "), true);
  assert.equal(isCompactOrCompressPrompt("/compress extra"), true);
  assert.equal(isCompactOrCompressPrompt("/compacted"), false);
  const current = { used: 10, size: 100, breakdown: [{ source: "messages" as const, chars: 4 }] };
  assert.deepEqual(
    mergeBotTaskUsage({
      currentUsage: current,
      incomingUsage: { used: 10, size: 100 },
    }),
    { used: 10, size: 100, breakdown: current.breakdown },
  );
  assert.equal(
    mergeBotTaskUsage({
      currentUsage: current,
      incomingUsage: { used: 0, size: 100 },
    }),
    current,
  );
  assert.deepEqual(
    mergeBotTaskUsage({
      currentUsage: current,
      incomingUsage: { used: 0, size: 100 },
      latestUserPrompt: "/compact",
    }),
    { used: 0, size: 100 },
  );
});

test("bot task payload readers reject shapes the published guards drop", () => {
  assert.equal(
    readBotTaskListPayload({ workspacePath: WORKSPACE_PATH, taskId: "t", updatedAt: 1 }),
    null,
  );
  assert.equal(
    readBotTaskListPayload({
      workspacePath: WORKSPACE_PATH,
      taskId: "t",
      updatedAt: 1,
      event: "created",
      task: { taskId: 1 },
    }),
    null,
  );
  assert.equal(
    readBotTaskStreamPayload({
      workspacePath: WORKSPACE_PATH,
      taskId: "t",
      updatedAt: 1,
      event: { type: "agent_message_chunk", taskId: "other" },
    }),
    null,
  );
  assert.equal(readBotTaskStreamPayload({ workspacePath: WORKSPACE_PATH })?.taskId, undefined);
});

test("created list broadcast projects creating status for an open workspace tab", () => {
  resetStores();
  handleBotTaskBroadcastMessage(
    {
      channel: "bots:task",
      payload: {
        workspacePath: WORKSPACE_PATH,
        taskId: "task-created",
        updatedAt: 3,
        event: "created",
        task: task("task-created"),
      },
    },
    workspaceTabs(),
  );
  const workspace = useZCodeSessionStore.getState().getWorkspaceState(WORKSPACE_PATH);
  assert.equal(workspace.taskRuntimeByTaskId["task-created"]?.status, "creating");
  assert.equal(workspace.taskListVersion, 1);
  assert.equal(workspace.optimisticTaskListByTaskId["task-created"]?.taskId, "task-created");
});

test("task stream ignores the active local task and projects other tasks", () => {
  resetStores();
  useZCodeSessionStore.getState().setActiveTaskId(WORKSPACE_PATH, "task-active");
  handleBotTaskBroadcastMessage(
    {
      channel: "bots:task-stream",
      payload: {
        workspacePath: WORKSPACE_PATH,
        taskId: "task-active",
        updatedAt: 4,
        event: { type: "agent_message_chunk", taskId: "task-active" },
      },
    },
    workspaceTabs(),
  );
  assert.equal(
    useZCodeSessionStore.getState().getWorkspaceState(WORKSPACE_PATH).taskRuntimeByTaskId[
      "task-active"
    ]?.status,
    undefined,
  );

  handleBotTaskBroadcastMessage(
    {
      channel: "bots:task-stream",
      payload: {
        workspacePath: WORKSPACE_PATH,
        taskId: "task-other",
        updatedAt: 5,
        event: { type: "agent_message_chunk", taskId: "task-other" },
      },
    },
    workspaceTabs(),
  );
  assert.equal(
    useZCodeSessionStore.getState().getWorkspaceState(WORKSPACE_PATH).taskRuntimeByTaskId[
      "task-other"
    ]?.status,
    "streaming",
  );
});

test("bot task broadcasts for a closed workspace are ignored", () => {
  resetStores();
  handleBotTaskBroadcastMessage(
    {
      channel: "bots:task",
      payload: {
        workspacePath: "/tmp/other-workspace",
        taskId: "task-other-workspace",
        updatedAt: 6,
        event: "updated",
      },
    },
    workspaceTabs(),
  );
  assert.deepEqual(useZCodeSessionStore.getState().workspaces, {});
});

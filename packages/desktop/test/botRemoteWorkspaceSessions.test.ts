import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BrowserWindow, MessagePortMain } from "electron";
import { HostMessageTypes, PlatformChannels, type RemoteTarget } from "@zcode/shared";
import {
  BOT_REMOTE_WORKSPACE_RECONNECT_HANDLER_MISSING,
  BOT_REMOTE_WORKSPACE_RUNTIME_HANDLER_MISSING,
  BOT_REMOTE_WORKSPACE_STATUS_HANDLER_MISSING,
  createBotRemoteWorkspaceHostHandlers,
  dispatchBotRemoteWorkspaceHostMessage,
} from "../src/main/botRemoteWorkspaceHostDispatch.ts";
import {
  admitBotRemoteWorkspaceReconnect,
  BOT_REMOTE_WORKSPACE_RUNTIME_SESSION_MISSING,
  hasRemoteWorkspaceSessionForTarget,
  requireBotRemoteWorkspaceSessionId,
  type BotRemoteAttachmentRouteSnapshot,
} from "../src/main/botRemoteWorkspaceSessionLookup.ts";
import { isSameRemoteTarget } from "../src/main/remoteTargetEquality.ts";

const ssh = (patch: Partial<Extract<RemoteTarget, { kind: "ssh" }>> = {}): RemoteTarget => ({
  kind: "ssh",
  host: "Example.COM",
  username: "me",
  ...patch,
});

function route(
  patch: Partial<BotRemoteAttachmentRouteSnapshot> & {
    descriptor?: Partial<BotRemoteAttachmentRouteSnapshot["descriptor"]>;
  } = {},
): BotRemoteAttachmentRouteSnapshot {
  return {
    webContentsId: 7,
    attachmentState: "attachable",
    ...patch,
    descriptor: {
      workspacePath: "/work",
      workspaceIdentity: "remote:ssh:box:/work",
      target: ssh(),
      ...patch.descriptor,
    },
  };
}

describe("isSameRemoteTarget", () => {
  it("matches ssh by host, default port, username, and private key path", () => {
    assert.equal(
      isSameRemoteTarget(ssh(), ssh({ host: " example.com ", port: 22, username: "me" })),
      true,
    );
    assert.equal(isSameRemoteTarget(ssh(), ssh({ port: 2222 })), false);
    assert.equal(
      isSameRemoteTarget(ssh({ privateKeyPath: undefined }), ssh({ privateKeyPath: "" })),
      true,
    );
    assert.equal(isSameRemoteTarget(ssh({ password: "a" }), ssh({ password: "b" })), true);
  });

  it("treats blank wsl distro as default and compares docker container text", () => {
    assert.equal(
      isSameRemoteTarget({ kind: "wsl", distro: "  ", user: " " }, { kind: "wsl" }),
      true,
    );
    assert.equal(
      isSameRemoteTarget(
        { kind: "docker", container: "box" },
        { kind: "docker", container: " box" },
      ),
      false,
    );
    assert.equal(isSameRemoteTarget(ssh(), { kind: "docker", container: "box" }), false);
  });

  it("compares server urls only", () => {
    assert.equal(
      isSameRemoteTarget(
        {
          kind: "server",
          url: "wss://cdn.example/ws?token=a#frag",
          serverId: "a",
          token: "secret",
        },
        { kind: "server", url: "https://cdn.example", serverId: "b" },
      ),
      true,
    );
    assert.equal(
      isSameRemoteTarget(
        { kind: "server", url: "https://cdn.example/ws/host" },
        { kind: "server", url: "https://cdn.example" },
      ),
      false,
    );
  });
});

describe("bot remote session lookup", () => {
  it("filters by window, attachable state, target, and workspace key", () => {
    const routes = new Map<string, BotRemoteAttachmentRouteSnapshot>([
      ["closed", route({ attachmentState: "closed" })],
      ["other-window", route({ webContentsId: 8 })],
      ["other-target", route({ descriptor: { target: ssh({ host: "other.example" }) } })],
      ["match", route()],
    ]);
    assert.equal(
      hasRemoteWorkspaceSessionForTarget(routes, 7, ssh(), {
        workspacePath: "/work",
        workspaceIdentity: "  remote:ssh:box:/work  ",
      }),
      true,
    );
    assert.equal(hasRemoteWorkspaceSessionForTarget(routes, 7, ssh()), true);
    assert.equal(
      hasRemoteWorkspaceSessionForTarget(routes, 7, ssh(), {
        workspacePath: "",
        workspaceIdentity: "",
      }),
      true,
    );
    assert.equal(
      hasRemoteWorkspaceSessionForTarget(routes, 7, ssh(), {
        workspacePath: "/other",
        workspaceIdentity: "",
      }),
      false,
    );
    assert.equal(
      hasRemoteWorkspaceSessionForTarget(routes, 7, ssh(), {
        workspacePath: "/other",
        workspaceIdentity: "remote:ssh:other",
      }),
      false,
    );
  });

  it("reuses an attachable session and dedupes in-flight reconnects by identity", async () => {
    const routes = new Map<string, BotRemoteAttachmentRouteSnapshot>([["sess-1", route()]]);
    const inFlight = new Map<string, Promise<string>>();
    const request = {
      requestId: "req-1",
      workspacePath: "/work",
      workspaceIdentity: "remote:ssh:box:/work",
      target: ssh(),
    };
    assert.equal(
      await admitBotRemoteWorkspaceReconnect({
        routes,
        inFlight,
        webContentsId: 7,
        request,
        createSession: () => Promise.reject(new Error("should not create")),
      }),
      "sess-1",
    );

    routes.clear();
    let calls = 0;
    let resolveCreated: (sessionId: string) => void = () => {};
    const created = new Promise<string>((resolve) => {
      resolveCreated = resolve;
    });
    const first = admitBotRemoteWorkspaceReconnect({
      routes,
      inFlight,
      webContentsId: 7,
      request,
      createSession: () => {
        calls += 1;
        return created;
      },
    });
    const second = admitBotRemoteWorkspaceReconnect({
      routes,
      inFlight,
      webContentsId: 7,
      request: { ...request, requestId: "req-2" },
      createSession: () => Promise.reject(new Error("duplicate")),
    });
    assert.equal(calls, 1);
    assert.equal(first, second);
    resolveCreated("sess-2");
    assert.equal(await first, "sess-2");
    await Promise.resolve();
    assert.equal(inFlight.size, 0);
    assert.throws(
      () => requireBotRemoteWorkspaceSessionId(routes, 7, request),
      new Error(BOT_REMOTE_WORKSPACE_RUNTIME_SESSION_MISSING),
    );
  });
});

describe("bot remote host dispatch", () => {
  const target = ssh();

  function posted() {
    const messages: Array<{ message: unknown; transfer?: unknown[] }> = [];
    return {
      messages,
      child: {
        postMessage(message: unknown, transfer?: MessagePortMain[]) {
          messages.push({ message, transfer });
        },
      },
    };
  }

  it("replies with the published missing-handler errors", () => {
    const sink = posted();
    const win = {} as BrowserWindow;
    assert.equal(
      dispatchBotRemoteWorkspaceHostMessage({
        message: {
          type: "bot-remote-workspace-reconnect-request",
          requestId: "r1",
          workspacePath: "/work",
          workspaceIdentity: "id",
          target,
        },
        win,
        child: sink.child,
        handlers: {},
      }),
      true,
    );
    assert.deepEqual(sink.messages[0]?.message, {
      type: HostMessageTypes.BotRemoteWorkspaceReconnectResult,
      requestId: "r1",
      ok: false,
      error: BOT_REMOTE_WORKSPACE_RECONNECT_HANDLER_MISSING,
    });
    dispatchBotRemoteWorkspaceHostMessage({
      message: {
        type: "bot-remote-workspace-connection-status-request",
        requestId: "r2",
        workspacePath: "/work",
        workspaceIdentity: "id",
        target,
      },
      win,
      child: sink.child,
      handlers: {},
    });
    const statusMessage = sink.messages[1]?.message as { error?: string } | undefined;
    assert.equal(statusMessage?.error, BOT_REMOTE_WORKSPACE_STATUS_HANDLER_MISSING);
    dispatchBotRemoteWorkspaceHostMessage({
      message: {
        type: "bot-remote-workspace-runtime-port-request",
        requestId: "r3",
        workspacePath: "/work",
        workspaceIdentity: "id",
        target,
      },
      win,
      child: sink.child,
      handlers: {},
    });
    const runtimeMessage = sink.messages[2]?.message as { error?: string } | undefined;
    assert.equal(runtimeMessage?.error, BOT_REMOTE_WORKSPACE_RUNTIME_HANDLER_MISSING);
    assert.equal(
      dispatchBotRemoteWorkspaceHostMessage({
        message: { type: "log" },
        win,
        child: sink.child,
        handlers: {},
      }),
      false,
    );
  });

  it("notifies the renderer and transfers the runtime port", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const win = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: (channel: string, payload: unknown) => {
          sent.push({ channel, payload });
        },
      },
    } as unknown as BrowserWindow;
    const port = { kind: "port" } as unknown as MessagePortMain;
    const handlers = createBotRemoteWorkspaceHostHandlers({
      reconnectBotRemoteWorkspaceSession: async () => "sess-9",
      hasRemoteWorkspaceSessionForTarget: () => false,
      createBotRemoteWorkspaceRuntimePort: () => port,
    });
    const sink = posted();
    dispatchBotRemoteWorkspaceHostMessage({
      message: {
        type: "bot-remote-workspace-reconnect-request",
        requestId: "r1",
        workspacePath: "/work",
        workspaceIdentity: "id",
        target,
      },
      win,
      child: sink.child,
      handlers,
    });
    dispatchBotRemoteWorkspaceHostMessage({
      message: {
        type: "bot-remote-workspace-connection-status-request",
        requestId: "r2",
        workspacePath: "/work",
        workspaceIdentity: "id",
        target,
      },
      win,
      child: sink.child,
      handlers,
    });
    dispatchBotRemoteWorkspaceHostMessage({
      message: {
        type: "bot-remote-workspace-runtime-port-request",
        requestId: "r3",
        workspacePath: "/work",
        workspaceIdentity: "id",
        target,
      },
      win,
      child: sink.child,
      handlers,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(sent, [
      {
        channel: PlatformChannels.BotRemoteWorkspaceReconnected,
        payload: {
          sessionId: "sess-9",
          workspacePath: "/work",
          workspaceIdentity: "id",
          target,
        },
      },
    ]);
    const byRequest = new Map(
      sink.messages.map((entry) => [(entry.message as { requestId: string }).requestId, entry]),
    );
    assert.deepEqual(byRequest.get("r1")?.message, {
      type: HostMessageTypes.BotRemoteWorkspaceReconnectResult,
      requestId: "r1",
      ok: true,
      sessionId: "sess-9",
      error: undefined,
    });
    assert.deepEqual(byRequest.get("r2")?.message, {
      type: HostMessageTypes.BotRemoteWorkspaceConnectionStatusResult,
      requestId: "r2",
      ok: true,
      connected: false,
      error: undefined,
    });
    assert.deepEqual(byRequest.get("r3"), {
      message: {
        type: HostMessageTypes.BotRemoteWorkspaceRuntimePort,
        requestId: "r3",
        ok: true,
      },
      transfer: [port],
    });
  });
});

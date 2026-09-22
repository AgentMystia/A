import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { WebSocketServer } from "ws";
import {
  IClientConfigService,
  IConversationShareService,
  IMediaPreviewService,
  IPluginSyncService,
  type IClientConfigService as ClientConfig,
  type IServiceAccessor,
} from "@zcode/services";
import { buildRemoteEnvironmentKey, ZCODE_RPC_HOST_CAPABILITY_HEADER } from "@zcode/shared";
import { resolveResourceTelemetryEnvironmentKey } from "../src/host/hostResourceTelemetryEnvironment.ts";
import {
  authenticatedUrl,
  connectServerRemote,
  disposeHostRemoteConnection,
  fetchHostCapability,
  fetchServerInfo,
  resolveServerRemoteEndpoints,
  wrapNodeWebSocket,
  type ServerRemoteFetch,
} from "../src/host/serverRemoteConnection.ts";
import { createServerRemoteWorkspaceServiceCollection } from "../src/host/serverRemoteWorkspaceServiceCollection.ts";

const serverInfo = {
  serverId: "box-1",
  version: "1.0.0",
  protocolVersion: 1,
  authRequired: true,
  workspaces: [{ path: "/work" }],
  capabilities: {
    desktopContinuous: true,
    websocketRpc: true,
    processResourceTelemetry: true,
  },
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("server remote endpoints", () => {
  it("rejects an empty URL before parsing", () => {
    assert.throws(() => resolveServerRemoteEndpoints("  "), /Server URL is required/);
  });

  it("rejects unsupported protocols", () => {
    assert.throws(
      () => resolveServerRemoteEndpoints("ftp://example.com/work"),
      /Unsupported server URL protocol: ftp:/,
    );
  });

  it("maps https URLs onto wss sockets and strips query and hash", () => {
    const endpoints = resolveServerRemoteEndpoints("https://example.com/base/ws?token=old#frag");
    assert.equal(endpoints.infoUrl, "https://example.com/base/api/server-info");
    assert.equal(endpoints.hostCapabilityUrl, "https://example.com/base/api/rpc-host-capability");
    assert.equal(endpoints.wsUrl, "wss://example.com/base/ws");
    assert.equal(endpoints.hostWsUrl, "wss://example.com/base/ws/host");
  });

  it("strips an existing /ws/host suffix before appending paths", () => {
    const endpoints = resolveServerRemoteEndpoints("ws://example.com/ws/host/");
    assert.equal(endpoints.infoUrl, "http://example.com/api/server-info");
    assert.equal(endpoints.hostCapabilityUrl, "http://example.com/api/rpc-host-capability");
    assert.equal(endpoints.wsUrl, "ws://example.com/ws");
    assert.equal(endpoints.hostWsUrl, "ws://example.com/ws/host");
  });

  it("adds a query token only when the trimmed token is non-empty", () => {
    assert.equal(
      authenticatedUrl("https://example.com/api/server-info", {}),
      "https://example.com/api/server-info",
    );
    assert.equal(
      authenticatedUrl("https://example.com/api/server-info", { token: "  " }),
      "https://example.com/api/server-info",
    );
    const authed = new URL(
      authenticatedUrl("https://example.com/api/server-info", { token: "secret token" }),
    );
    assert.equal(authed.searchParams.get("token"), "secret token");
  });
});

describe("server remote handshake requests", () => {
  it("sends bearer auth on server info and rejects invalid payloads", async () => {
    const calls: Array<{
      url: string;
      init?: { method?: string; headers?: Record<string, string> };
    }> = [];
    const fetchImpl: ServerRemoteFetch = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, serverInfo);
    };
    const info = await fetchServerInfo(
      "https://example.com/api/server-info",
      { token: "secret" },
      fetchImpl,
    );
    assert.equal(info.serverId, "box-1");
    assert.equal(calls[0]?.url, "https://example.com/api/server-info?token=secret");
    assert.equal(calls[0]?.init?.headers?.authorization, "Bearer secret");

    const failed: ServerRemoteFetch = async () => jsonResponse(401, {});
    await assert.rejects(
      () => fetchServerInfo("https://example.com/api/server-info", { token: "secret" }, failed),
      /Server info request failed: 401/,
    );
    const invalid: ServerRemoteFetch = async () => jsonResponse(200, { serverId: "x" });
    await assert.rejects(
      () => fetchServerInfo("https://example.com/api/server-info", {}, invalid),
      /Server info response is invalid/,
    );
  });

  it("posts host capability without an authorization header", async () => {
    const calls: Array<{
      url: string;
      init?: { method?: string; headers?: Record<string, string> };
    }> = [];
    const fetchImpl: ServerRemoteFetch = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, { capability: "cap-1", expiresAt: 1_700_000_000_000 });
    };
    const capability = await fetchHostCapability(
      "https://example.com/api/rpc-host-capability",
      { token: "secret" },
      fetchImpl,
    );
    assert.equal(capability, "cap-1");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal(calls[0]?.init?.headers, undefined);
    assert.equal(calls[0]?.url, "https://example.com/api/rpc-host-capability?token=secret");

    const failed: ServerRemoteFetch = async () => jsonResponse(503, {});
    await assert.rejects(
      () => fetchHostCapability("https://example.com/api/rpc-host-capability", {}, failed),
      /Host capability request failed: 503/,
    );
    const invalid: ServerRemoteFetch = async () => jsonResponse(200, { capability: "" });
    await assert.rejects(
      () => fetchHostCapability("https://example.com/api/rpc-host-capability", {}, invalid),
      /Host capability response is invalid/,
    );
  });
});

describe("server remote websocket wrap", () => {
  it("reports close reasons and does not report error as a user close", () => {
    const listeners = new Map<string, Array<(...args: never[]) => void>>();
    const socket = {
      readyState: 1,
      sent: [] as unknown[],
      closed: 0,
      on(event: string, listener: (...args: never[]) => void) {
        const list = listeners.get(event) ?? [];
        list.push(listener);
        listeners.set(event, list);
      },
      send(data: Uint8Array) {
        this.sent.push(data);
      },
      close() {
        this.closed += 1;
      },
    };
    const closes: Array<{ code: number; reason: string }> = [];
    const wrapped = wrapNodeWebSocket(socket, (event) => closes.push(event));
    const chunks: Uint8Array[] = [];
    wrapped.onData((chunk) => {
      chunks.push(chunk.buffer);
    });
    listeners.get("message")?.[0]?.(Buffer.from("hi"));
    assert.equal(Buffer.from(chunks[0] ?? []).toString("utf8"), "hi");
    wrapped.write({ buffer: new Uint8Array([1, 2]) } as never);
    assert.deepEqual(socket.sent, [new Uint8Array([1, 2])]);

    listeners.get("error")?.[0]?.(new Error("boom"));
    assert.deepEqual(closes, []);
    listeners.get("close")?.[0]?.(1000, Buffer.from("bye"));
    assert.deepEqual(closes, [{ code: 1000, reason: "bye" }]);
    wrapped.dispose();
    assert.equal(socket.closed, 1);
  });
});

describe("server remote connect", () => {
  it("fetches info, posts capability, then opens /ws/host with the capability header", async () => {
    const requests: string[] = [];
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      requests.push(`${req.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/api/server-info") {
        assert.equal(req.headers.authorization, "Bearer secret");
        assert.equal(url.searchParams.get("token"), "secret");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(serverInfo));
        return;
      }
      if (url.pathname === "/api/rpc-host-capability") {
        assert.equal(req.method, "POST");
        assert.equal(req.headers.authorization, undefined);
        assert.equal(url.searchParams.get("token"), "secret");
        res.end(JSON.stringify({ capability: "cap-1", expiresAt: Date.now() + 60_000 }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      requests.push(`UPGRADE ${url.pathname}`);
      assert.equal(url.pathname, "/ws/host");
      assert.equal(url.searchParams.get("token"), "secret");
      assert.equal(req.headers.authorization, "Bearer secret");
      assert.equal(req.headers[ZCODE_RPC_HOST_CAPABILITY_HEADER], "cap-1");
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    try {
      const connection = await connectServerRemote(
        { kind: "server", url: `http://127.0.0.1:${port}/ws`, token: "secret" },
        {},
      );
      assert.equal(connection.serverInfo.serverId, "box-1");
      assert.deepEqual(requests, [
        "GET /api/server-info",
        "POST /api/rpc-host-capability",
        "UPGRADE /ws/host",
      ]);
      connection.dispose();
    } finally {
      await new Promise<void>((resolve, reject) =>
        wss.close((error) => (error ? reject(error) : resolve())),
      );
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

describe("server remote dispose and telemetry", () => {
  it("uses disposeAndWait when present and dispose otherwise", async () => {
    let waited = 0;
    let disposed = 0;
    await disposeHostRemoteConnection({
      dispose() {
        disposed += 1;
      },
      async disposeAndWait() {
        waited += 1;
      },
    });
    await disposeHostRemoteConnection({
      dispose() {
        disposed += 1;
      },
    });
    assert.equal(waited, 1);
    assert.equal(disposed, 1);
  });

  it("overlays serverInfo.serverId only for server targets", () => {
    const target = { kind: "server" as const, url: "https://example.com/work", serverId: "local" };
    const overlaid = resolveResourceTelemetryEnvironmentKey(target, "from-info");
    const expected = createHash("sha256")
      .update(buildRemoteEnvironmentKey({ ...target, serverId: "from-info" }))
      .digest("hex");
    assert.equal(overlaid, expected);
    assert.equal(
      resolveResourceTelemetryEnvironmentKey(target),
      createHash("sha256").update(buildRemoteEnvironmentKey(target)).digest("hex"),
    );
    const ssh = { kind: "ssh" as const, host: "example.com", username: "me" };
    assert.equal(
      resolveResourceTelemetryEnvironmentKey(ssh, "from-info"),
      createHash("sha256").update(buildRemoteEnvironmentKey(ssh)).digest("hex"),
    );
  });
});

describe("server remote service collection", () => {
  it("uses the injected client config and rejects conversation share", async () => {
    const localConfig = { source: "window-host" } as ClientConfig;
    const connectionShare = {
      async getCapabilities() {
        return { enabled: true };
      },
    };
    const accessor = new Proxy({} as IServiceAccessor, {
      get(_target, property) {
        if (property === "mediaPreviewService") return undefined;
        if (property === "conversationShareService") return connectionShare;
        if (property === "fileService") return { stat: async () => ({ type: "file", size: 0 }) };
        return { channel: String(property) };
      },
    });
    const services = createServerRemoteWorkspaceServiceCollection({
      clientConfigService: localConfig,
      connectionServices: accessor,
    });
    assert.equal(services.get(IClientConfigService), localConfig);
    assert.equal(services.getOptional(IPluginSyncService), undefined);
    assert.notEqual(services.get(IConversationShareService), connectionShare);
    assert.equal(typeof services.get(IMediaPreviewService).prepare, "function");
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      await assert.rejects(
        () => services.get(IConversationShareService).getCapabilities(),
        /Conversation sharing is not available for this client or remote target/,
      );
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(
      warnings.some(
        (args) =>
          args.includes("conversation share action rejected") &&
          args.some(
            (arg) =>
              typeof arg === "object" &&
              arg !== null &&
              "reason" in arg &&
              arg.reason === "server_remote_unsupported",
          ),
      ),
    );
  });
});

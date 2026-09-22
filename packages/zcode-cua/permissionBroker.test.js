import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { callBrokerMethod, CuaHelperError, probeHelperHealth } from "./broker.js";
import {
  PermissionBrokerClient,
  PermissionBrokerError,
  businessResponseTimeout,
  defaultPeerCredentialChecker,
  legacyHelperMessageProvesActionNotSent,
} from "./permissionBrokerClient.js";
import { createPipSessionClient } from "./pip-session-node.js";

const permissivePeer = { verifySocketPeer() {} };

async function listen(handler) {
  const directory = await mkdtemp(join(tmpdir(), "zcode-broker-"));
  const socketPath = join(directory, "broker.sock");
  const server = createServer(handler);
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return {
    socketPath,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function nextMessage(socket) {
  let buffer = "";
  const pending = [];
  let waiting = null;
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve(message);
      } else {
        pending.push(message);
      }
    }
  });
  return () =>
    pending.length > 0
      ? Promise.resolve(pending.shift())
      : new Promise((resolve) => {
          waiting = resolve;
        });
}

test("callBrokerMethod authenticates with an empty payload then returns the method result", async () => {
  const seen = [];
  const endpoint = await listen((socket) => {
    const read = nextMessage(socket);
    void (async () => {
      seen.push(await read());
      socket.write(`${JSON.stringify({ id: 0, ok: true })}\n`);
      seen.push(await read());
      socket.write(
        `${JSON.stringify({ id: 1, ok: true, result: { accessibility: "granted" } })}\n`,
      );
    })();
  });
  try {
    const result = await callBrokerMethod({
      socketPath: endpoint.socketPath,
      method: "permission_status",
      timeoutMs: 1000,
    });
    assert.deepEqual(result, { accessibility: "granted" });
    assert.deepEqual(seen[0], { id: 0, method: "authenticate", params: {} });
    assert.equal(seen[1].id, 1);
    assert.equal(seen[1].method, "permission_status");
  } finally {
    await endpoint.close();
  }
});

test("probeHelperHealth stops immediately when authenticate is rejected", async () => {
  const endpoint = await listen((socket) => {
    socket.write(`${JSON.stringify({ id: 0, ok: false })}\n`);
  });
  try {
    await assert.rejects(
      () => probeHelperHealth(endpoint.socketPath, { timeoutMs: 2000, pollIntervalMs: 50 }),
      (error) => {
        assert.ok(error instanceof CuaHelperError);
        assert.equal(error.code, "auth_failed");
        assert.match(error.message, /code-signature gate/);
        return true;
      },
    );
  } finally {
    await endpoint.close();
  }
});

test("callBrokerMethod redacts the socket path from broker errors", async () => {
  const endpoint = await listen((socket) => {
    const read = nextMessage(socket);
    void (async () => {
      await read();
      socket.write(`${JSON.stringify({ id: 0, ok: true })}\n`);
      await read();
      socket.write(
        `${JSON.stringify({ id: 1, ok: false, error: { message: `down ${endpoint.socketPath}` } })}\n`,
      );
    })();
  });
  try {
    await assert.rejects(
      () => callBrokerMethod({ socketPath: endpoint.socketPath, method: "permission_status" }),
      (error) => {
        assert.equal(error instanceof Error, true);
        assert.match(error.message, /down <socket>/);
        assert.equal(error.message.includes(endpoint.socketPath), false);
        return true;
      },
    );
  } finally {
    await endpoint.close();
  }
});

test("hold_key extends the broker timeout and legacy helper text marks action_sent", () => {
  assert.equal(businessResponseTimeout(3000, "click", {}), 3000);
  assert.equal(businessResponseTimeout(3000, "hold_key", { duration: 10 }), 15_000);
  assert.equal(businessResponseTimeout(3000, "hold_key", { duration: 0 }), 3000);
  const error = new PermissionBrokerError("element (1) is not settable; refuse set_value");
  assert.match(error.message, /action_sent=false\.$/);
  assert.equal(legacyHelperMessageProvesActionNotSent("unrelated"), false);
});

test("default peer checker rejects a world-writable socket path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-peer-"));
  const socketPath = join(directory, "broker.sock");
  try {
    await writeFile(socketPath, "");
    await chmod(socketPath, 0o600);
    assert.doesNotThrow(() => defaultPeerCredentialChecker().verifySocketPeer(socketPath));
    await chmod(socketPath, 0o666);
    assert.throws(
      () => defaultPeerCredentialChecker().verifySocketPeer(socketPath),
      (error) => error instanceof PermissionBrokerError && error.code === "untrusted_socket",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PermissionBrokerClient sends presentation auth and returns the method result", async () => {
  const seen = [];
  const endpoint = await listen((socket) => {
    const read = nextMessage(socket);
    void (async () => {
      const auth = await read();
      seen.push(auth);
      socket.write(`${JSON.stringify({ id: 0, ok: true })}\n`);
      const request = await read();
      seen.push(request);
      socket.write(
        `${JSON.stringify({ id: request.id, ok: true, result: { applied: true }, presentation: { ok: 1 } })}\n`,
      );
    })();
  });
  const presentations = [];
  try {
    const client = new PermissionBrokerClient(endpoint.socketPath, {
      timeoutMs: 1000,
      peerChecker: permissivePeer,
      authenticateParams: { role: "presentation" },
      onPresentation: (presentation) => presentations.push(presentation),
    });
    const result = await client.call("pip_session_event", { event: { kind: "session-closed" } });
    assert.deepEqual(result, { applied: true });
    assert.deepEqual(seen[0].params, { clientApiVersion: 2, role: "presentation" });
    assert.equal(seen[1].id, 1);
    assert.deepEqual(presentations, [{ ok: 1 }]);
  } finally {
    await endpoint.close();
  }
});

test("createPipSessionClient handshakes once and rejects a reserved identifier before connecting", async () => {
  let connections = 0;
  const endpoint = await listen((socket) => {
    connections += 1;
    const read = nextMessage(socket);
    void (async () => {
      const auth = await read();
      socket.write(`${JSON.stringify({ id: 0, ok: true })}\n`);
      const request = await read();
      const result =
        request.method === "pip_session_handshake"
          ? { ready: true, protocolVersion: 2, runtimeId: "zcode-cua-pip-session-v2" }
          : { applied: true, reason: request.params.event.kind };
      socket.write(
        `${JSON.stringify({ id: auth.id === 0 ? request.id : request.id, ok: true, result })}\n`,
      );
    })();
  });
  try {
    const client = createPipSessionClient({
      socketPath: endpoint.socketPath,
      peerChecker: permissivePeer,
      reconnectDelayMs: 0,
    });
    await assert.rejects(() =>
      client.send({
        kind: "turn-started",
        sessionId: "__zcode_pip_no_active_session_v2__",
        turnId: "turn",
        sequenceNumber: 1,
        eventId: "event",
      }),
    );
    assert.equal(connections, 0);
    const applied = await client.send({
      kind: "focus-changed",
      revision: 1,
      sourceWindowId: " window-1 ",
      sessionId: null,
    });
    assert.deepEqual(applied, { applied: true, reason: "focus-changed" });
    assert.equal(connections, 2);
    assert.equal(client.enabled, true);
  } finally {
    await endpoint.close();
  }
});

test("PiP retries a closed broker socket before the handshake succeeds", async () => {
  let connections = 0;
  const endpoint = await listen((socket) => {
    connections += 1;
    if (connections === 1) {
      socket.destroy();
      return;
    }
    const read = nextMessage(socket);
    void (async () => {
      await read();
      socket.write(`${JSON.stringify({ id: 0, ok: true })}\n`);
      const request = await read();
      socket.write(
        `${JSON.stringify({ id: request.id, ok: true, result: { ready: true, protocolVersion: 2, runtimeId: "zcode-cua-pip-session-v2" } })}\n`,
      );
    })();
  });
  try {
    const client = createPipSessionClient({
      socketPath: endpoint.socketPath,
      peerChecker: permissivePeer,
      reconnectAttempts: 1,
      reconnectDelayMs: 0,
    });
    await client.connect();
    assert.equal(connections, 2);
    assert.equal(client.enabled, true);
  } finally {
    await endpoint.close();
  }
});

test("PiP handshake mismatch disables the client after one diagnostic", async () => {
  const diagnostics = [];
  const endpoint = await listen((socket) => {
    const read = nextMessage(socket);
    void (async () => {
      await read();
      socket.write(`${JSON.stringify({ id: 0, ok: true })}\n`);
      const request = await read();
      socket.write(
        `${JSON.stringify({ id: request.id, ok: true, result: { ready: true, protocolVersion: 1, runtimeId: "other" } })}\n`,
      );
    })();
  });
  try {
    const client = createPipSessionClient({
      socketPath: endpoint.socketPath,
      peerChecker: permissivePeer,
      reconnectDelayMs: 0,
      onDiagnostic(diagnostic) {
        diagnostics.push(diagnostic.code);
        if (diagnostics.length > 1) throw new Error("diagnostic callback failed");
      },
    });
    await assert.rejects(() => client.connect(), /Auto-PiP is disabled/);
    await assert.rejects(() => client.connect(), /Auto-PiP is disabled/);
    assert.deepEqual(diagnostics, ["version_mismatch"]);
    assert.equal(client.enabled, false);
  } finally {
    await endpoint.close();
  }
});

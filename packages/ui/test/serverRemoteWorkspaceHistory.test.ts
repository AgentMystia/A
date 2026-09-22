import assert from "node:assert/strict";
import test from "node:test";
import { buildRemoteWorkspaceIdentity as buildSharedRemoteWorkspaceIdentity } from "@zcode/shared";
import {
  buildRemoteWorkspaceIdentity,
  buildRemoteWorkspaceSessionMutation,
  formatRemoteWorkspaceHeaderHostLabel,
  formatRemoteWorkspaceTargetSubtitle,
} from "../src/lib/remoteWorkspaceHistory.js";

const serverTarget = {
  kind: "server" as const,
  url: "wss://example.com/ws?token=secret",
  name: "Desk",
  serverId: "Desk One",
  token: "secret",
  workspacePath: " /work ",
};

test("UI server identity delegates to the shared builder", () => {
  assert.equal(
    buildRemoteWorkspaceIdentity("work\\repo//", serverTarget),
    buildSharedRemoteWorkspaceIdentity("work\\repo//", serverTarget),
  );
  assert.equal(
    buildRemoteWorkspaceIdentity("foo/bar/", {
      kind: "ssh",
      host: "Host",
      username: "user",
    }),
    "remote:ssh:host:22:user:foo/bar",
  );
});

test("server history stores the token credential key and display labels", () => {
  const mutation = buildRemoteWorkspaceSessionMutation({
    remoteSessions: [],
    workspacePath: "/work",
    target: serverTarget,
    lastConnectionStatus: "connected",
    touchOpenedAt: false,
  });
  assert.equal(mutation.entry.target.kind, "server");
  if (mutation.entry.target.kind !== "server") {
    return;
  }
  const credentialKey = `remote-workspace:${mutation.entry.workspaceIdentity}:server-token`;
  assert.equal(mutation.entry.target.tokenCredentialKey, credentialKey);
  assert.equal(mutation.entry.target.name, "Desk");
  assert.equal(mutation.entry.target.serverId, "Desk One");
  assert.equal(mutation.entry.target.workspacePath, "/work");
  assert.equal("token" in mutation.entry.target, false);
  assert.deepEqual(mutation.credentialsToSave, [{ key: credentialKey, value: "secret" }]);
  assert.equal(formatRemoteWorkspaceTargetSubtitle(serverTarget), "Server · Desk");
  assert.equal(formatRemoteWorkspaceHeaderHostLabel(serverTarget), "example.com");

  const reused = buildRemoteWorkspaceSessionMutation({
    remoteSessions: [mutation.entry],
    workspacePath: "/work",
    workspaceIdentity: mutation.entry.workspaceIdentity,
    target: { ...serverTarget, token: "next" },
    lastConnectionStatus: "connected",
    touchOpenedAt: false,
  });
  assert.equal(reused.entry.target.kind, "server");
  if (reused.entry.target.kind === "server") {
    assert.equal(reused.entry.target.tokenCredentialKey, credentialKey);
  }
  assert.deepEqual(reused.credentialsToSave, [{ key: credentialKey, value: "next" }]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  appSettingsSchema,
  buildRemoteEnvironmentKey,
  buildRemoteWorkspaceIdentity,
  normalizeServerEndpoint,
  normalizeServerIdForIdentity,
  parseRemoteWorkspaceIdentity,
  remoteTargetSchema,
  resolveServerIdentityId,
  stripRemoteTargetSecrets,
} from "@zcode/shared";

const serverTarget = {
  kind: "server" as const,
  url: "wss://Example.COM:8443/ws?token=secret#frag",
  name: " Desk ",
  serverId: " Desk One ",
  token: "secret",
  workspacePath: "work\\repo//",
};

test("server identity prefers serverId, then name, then URL host", () => {
  assert.equal(resolveServerIdentityId(serverTarget), "Desk One");
  assert.equal(resolveServerIdentityId({ url: "https://Example.COM/a", name: " Named " }), "Named");
  assert.equal(resolveServerIdentityId({ url: "https://Example.COM/a", name: " " }), "example.com");
  assert.equal(resolveServerIdentityId({ url: "not a url" }), "not a url");
});

test("server id slug rejects an empty identity", () => {
  assert.equal(normalizeServerIdForIdentity(" Desk One "), "desk-one");
  assert.throws(
    () => normalizeServerIdForIdentity(" --- "),
    /serverId must contain at least one identity-safe character/,
  );
});

test("server workspace identity round-trips through the shared parser", () => {
  const identity = buildRemoteWorkspaceIdentity("work\\repo//", serverTarget);
  assert.equal(identity, "remote:server:desk-one:/work/repo");
  assert.deepEqual(parseRemoteWorkspaceIdentity(identity), {
    kind: "server",
    workspacePath: "/work/repo",
  });
  assert.deepEqual(parseRemoteWorkspaceIdentity("remote:server:desk-one:/foo:bar"), {
    kind: "server",
    workspacePath: "/foo:bar",
  });
  assert.equal(parseRemoteWorkspaceIdentity("remote:server:desk-one:work"), null);
  assert.equal(
    buildRemoteWorkspaceIdentity("", { kind: "server", url: "https://example.com" }),
    "remote:server:example.com:/",
  );
});

test("server environment key keeps serverId and telemetry-style endpoint omits it", () => {
  assert.equal(buildRemoteEnvironmentKey(serverTarget), "server:Desk One");
  assert.equal(
    buildRemoteEnvironmentKey({ kind: "server", url: serverTarget.url }),
    `server:${normalizeServerEndpoint(serverTarget.url)}`,
  );
  assert.equal(normalizeServerEndpoint(serverTarget.url), "https://example.com:8443");
});

test("server token stays off persisted settings and stripped targets", () => {
  const stripped = stripRemoteTargetSecrets(serverTarget);
  assert.equal(stripped.kind, "server");
  if (stripped.kind === "server") {
    assert.equal(stripped.token, undefined);
  }
  const live = remoteTargetSchema.parse(serverTarget);
  assert.equal(live.kind, "server");
  if (live.kind === "server") {
    assert.equal(live.token, "secret");
  }
  const settings = appSettingsSchema.parse({
    lastWorkspaceSession: [
      {
        kind: "remote",
        workspacePath: "/work",
        target: {
          kind: "server",
          url: "https://example.com",
          serverId: "desk",
          tokenCredentialKey: "remote-workspace:k:server-token",
          token: "secret",
        },
        lastOpenedAt: 1,
        lastConnectionStatus: "connected",
      },
    ],
  });
  const target = settings.lastWorkspaceSession?.[0];
  assert.equal(target?.kind, "remote");
  if (target?.kind === "remote") {
    assert.equal(target.target.kind, "server");
    if (target.target.kind === "server") {
      assert.equal(target.target.tokenCredentialKey, "remote-workspace:k:server-token");
      assert.equal("token" in target.target, false);
    }
  }
});

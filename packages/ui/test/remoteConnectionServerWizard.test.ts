import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRemoteTarget,
  listRemoteConnectionWizardKinds,
} from "../src/lib/remoteConnectionWizard.js";

const intl = {
  formatMessage: (descriptor: { id: string }) => descriptor.id,
};

const baseSnapshot = {
  host: "",
  port: "22",
  username: "",
  sshAuthMethod: "password" as const,
  password: "",
  privateKeyPath: "",
  privateKeyPassphrase: "",
  wslDistro: "",
  dockerContainer: "",
};

test("server appears in the remote wizard only for the local development runtime", () => {
  assert.deepEqual(
    listRemoteConnectionWizardKinds({
      isWindowsDesktop: false,
      isLocalDevelopmentRuntime: false,
    }),
    ["ssh", "docker"],
  );
  assert.deepEqual(
    listRemoteConnectionWizardKinds({
      isWindowsDesktop: true,
      isLocalDevelopmentRuntime: false,
    }),
    ["ssh", "wsl", "docker"],
  );
  assert.deepEqual(
    listRemoteConnectionWizardKinds({
      isWindowsDesktop: true,
      isLocalDevelopmentRuntime: true,
    }),
    ["ssh", "server", "wsl", "docker"],
  );
});

test("server wizard target keeps only trimmed url, name, token, and workspace path", () => {
  assert.deepEqual(
    buildRemoteTarget(intl, {
      ...baseSnapshot,
      kind: "server",
      serverUrl: "  ",
    }),
    { errorMessage: "server.validation.urlRequired" },
  );
  assert.deepEqual(
    buildRemoteTarget(intl, {
      ...baseSnapshot,
      kind: "server",
      serverUrl: "studio.example",
    }),
    { errorMessage: "server.validation.invalidUrl" },
  );
  assert.deepEqual(
    buildRemoteTarget(intl, {
      ...baseSnapshot,
      kind: "server",
      serverUrl: " https://studio.example.com:3030 ",
      serverName: " Studio ",
      serverToken: " ",
      serverWorkspacePath: " /srv/project ",
    }),
    {
      target: {
        kind: "server",
        url: "https://studio.example.com:3030",
        name: "Studio",
        workspacePath: "/srv/project",
      },
    },
  );
});

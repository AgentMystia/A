import assert from "node:assert/strict";
import test from "node:test";
import { WebRemoteControlRpcTransportAssembler } from "../src/webRemoteControlRpcAssembler.js";
import { encodeWebRemoteControlRpcTransportMessage } from "../src/webRemoteControlRpcCodec.js";
import {
  buildWebRemoteControlExternalQrUrl,
  isWebRemoteControlV4AppVersion,
} from "../src/webRemoteControlEndpoint.js";

test("v4 remote control starts at 3.4.0 and ignores that exact prerelease", () => {
  assert.equal(isWebRemoteControlV4AppVersion(undefined), false);
  assert.equal(isWebRemoteControlV4AppVersion("3.3.9"), false);
  assert.equal(isWebRemoteControlV4AppVersion("3.4.0-rc.1"), false);
  assert.equal(isWebRemoteControlV4AppVersion("3.4.0"), true);
  assert.equal(isWebRemoteControlV4AppVersion("3.4.1-rc.1"), true);
});

test("external QR query carries sid, hash and device fields without theme", () => {
  const url = new URL(
    buildWebRemoteControlExternalQrUrl({
      baseUrl: "https://zcode.z.ai/remote/v4",
      deviceSid: "device-1",
      passHash: "hash-1",
      timestamp: 1789890118000,
      deviceMid: "mid-1",
      deviceName: "desktop",
      appVersion: "3.14.1",
      theme: "dark",
    }),
  );
  assert.equal(url.searchParams.get("sid"), "device-1");
  assert.equal(url.searchParams.get("hash"), "hash-1");
  assert.equal(url.searchParams.get("t"), "1789890118000");
  assert.equal(url.searchParams.get("mid"), "mid-1");
  assert.equal(url.searchParams.get("name"), "desktop");
  assert.equal(url.searchParams.get("app_version"), "3.14.1");
  assert.equal(url.searchParams.get("theme"), null);
});

test("rpc frames reassemble to the original bytes", () => {
  const bytes = new TextEncoder().encode("web-remote-control");
  const frames = encodeWebRemoteControlRpcTransportMessage(bytes, {
    bridgeSessionId: "bridge-1",
    bridgeGeneration: 2,
    firstPhysicalSeq: 1,
    messageSeq: 1,
  });
  const assembler = new WebRemoteControlRpcTransportAssembler({
    identity: { bridgeSessionId: "bridge-1", bridgeGeneration: 2 },
  });
  let completed: Uint8Array | undefined;
  for (const frame of frames) {
    const accepted = assembler.accept(frame, 1_000);
    if (accepted?.kind === "complete") completed = accepted.bytes;
  }
  assert.ok(completed);
  assert.deepEqual(Array.from(completed), Array.from(bytes));
});

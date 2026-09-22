import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRewardsContextInjectionScript,
  buildRewardsWebviewUrl,
  isTrustedRewardsUrl,
  resolveRewardsWebviewOrigin,
} from "../src/rewardsWebview.js";

test("rewards urls accept only embedded cn/en pages on the published origins", () => {
  assert.equal(
    isTrustedRewardsUrl("https://zcode.z.ai/cn/rewards?embedded=app&theme=zai-dark"),
    true,
  );
  assert.equal(
    isTrustedRewardsUrl("https://zcode.chatglm.site/en/rewards/?embedded=app"),
    true,
  );
  assert.equal(isTrustedRewardsUrl("https://zcode.z.ai/rewards?embedded=app"), false);
  assert.equal(
    isTrustedRewardsUrl("https://user:secret@zcode.z.ai/cn/rewards?embedded=app"),
    false,
  );
  assert.equal(
    isTrustedRewardsUrl("http://localhost:3000/en/rewards?embedded=app", { dev: true }),
    true,
  );
  assert.equal(isTrustedRewardsUrl("http://localhost:3000/en/rewards?embedded=app"), false);
  assert.equal(
    isTrustedRewardsUrl("http://127.0.0.1:4173/cn/rewards?embedded=app", { e2e: true }),
    true,
  );
});

test("rewards origin uses the override only when the probed page stays trusted", () => {
  assert.equal(
    resolveRewardsWebviewOrigin({
      env: "production",
      override: "https://zcode.chatglm.site",
    }),
    "https://zcode.chatglm.site",
  );
  assert.equal(
    resolveRewardsWebviewOrigin({ env: "production", override: "https://evil.example" }),
    "https://zcode.z.ai",
  );
  assert.equal(resolveRewardsWebviewOrigin({ env: "test" }), "https://zcode.chatglm.site");
  assert.equal(
    buildRewardsWebviewUrl("https://zcode.z.ai", "zh-CN", "zai-light"),
    "https://zcode.z.ai/cn/rewards?embedded=app&theme=zai-light",
  );
});

test("rewards context script clears storage before writing the active tokens", () => {
  const script = buildRewardsContextInjectionScript(
    {
      theme: "zai-dark",
      locale: "en-US",
      auth: { status: "ready", provider: "zai", revision: 2 },
    },
    { oauth: " oauth-token ", jwt: "jwt-token" },
    "https://zcode.z.ai/en/rewards?embedded=app&theme=zai-dark",
  );
  assert.match(script, /window\.location\.href !== "https:\/\/zcode\.z\.ai\/en\/rewards\?embedded=app&theme=zai-dark"/);
  assert.match(script, /localStorage\.removeItem\(key\)/);
  assert.match(script, /"oauth:zai:access_token":"oauth-token"/);
  assert.match(script, /"zcodejwttoken":"jwt-token"/);
  assert.match(script, /new CustomEvent\("zcode-rewards-context"/);

  const anonymous = buildRewardsContextInjectionScript(
    {
      theme: "zai-light",
      locale: "zh-CN",
      auth: { status: "anonymous", provider: null, revision: 1 },
    },
    { oauth: "ignored", jwt: "ignored" },
  );
  assert.doesNotMatch(anonymous, /ignored/);
  assert.match(anonymous, /Object\.entries\(\{\}\)/);
});

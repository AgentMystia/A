import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILTIN_MODEL_PROVIDER_IDS,
  CODING_PLAN_SECURITY_VERIFICATION_REQUIRED,
  CODING_PLAN_SYSTEM_BUSY,
  isMainAgentToolProjectionSource,
  normalizeAgentProviderToZCodeAgent,
  readClaudeParentToolUseId,
} from "@zcode/shared";
import {
  isSecurityVerificationMessage,
  normalizeRemoteErrorMessage,
} from "../src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.js";
import { parentToolUseIdFromToolPayload } from "../src/zcode-agent/claudeParentToolUseId.js";

const providerId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan;

test("security verification messages become the published error code", () => {
  assert.equal(isSecurityVerificationMessage("请完成安全验证"), true);
  assert.equal(isSecurityVerificationMessage("Complete the Security Verification"), true);
  assert.equal(isSecurityVerificationMessage("ordinary failure"), false);
  assert.equal(
    normalizeRemoteErrorMessage("请完成安全验证后继续", providerId, 400),
    CODING_PLAN_SECURITY_VERIFICATION_REQUIRED,
  );
  assert.equal(
    normalizeRemoteErrorMessage("<html>请完成安全验证</html>", providerId),
    CODING_PLAN_SYSTEM_BUSY,
  );
  assert.equal(normalizeRemoteErrorMessage("quota exceeded", providerId, 7), "quota exceeded");
});

test("main-agent todo projection skips Claude parent tool metadata", () => {
  assert.equal(normalizeAgentProviderToZCodeAgent("codex"), "glm");
  assert.equal(
    readClaudeParentToolUseId({ _meta: { claudeCode: { parentToolUseId: " claude-1 " } } }),
    "claude-1",
  );
  assert.equal(readClaudeParentToolUseId({ _meta: { claudeCode: {} } }), undefined);
  assert.equal(
    isMainAgentToolProjectionSource({ _meta: { claudeCode: { parentToolUseId: "claude-1" } } }),
    false,
  );
  assert.equal(isMainAgentToolProjectionSource({ title: "todo" }), true);
});

test("parent tool ids fall through to Claude metadata", () => {
  assert.equal(
    parentToolUseIdFromToolPayload({
      parentToolCallId: "call-1",
      _meta: { claudeCode: { parentToolUseId: "claude-1" } },
    }),
    "call-1",
  );
  assert.equal(
    parentToolUseIdFromToolPayload({
      parentToolUseId: "",
      _meta: { claudeCode: { parentToolUseId: "claude-1" } },
    }),
    "claude-1",
  );
  assert.equal(parentToolUseIdFromToolPayload({ _meta: { claudeCode: {} } }), null);
});

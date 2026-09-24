import assert from "node:assert/strict";
import test from "node:test";

import { BUILTIN_MODEL_PROVIDER_IDS } from "@zcode/shared";
import { lookupConversationTelemetryParityCase } from "../src/v4/telemetry/conversationTelemetryParityCatalog.js";
import { installConversationTelemetryParityE2E } from "../src/v4/telemetry/conversationTelemetryParityE2E.js";
import {
  collectCaptchaParityAssertions,
  collectQuotaParityAssertions,
  resolveConversationTelemetryParityProviderId,
} from "../src/v4/telemetry/conversationTelemetryParityModel.js";
import { runConversationTelemetryParityCase } from "../src/v4/telemetry/conversationTelemetryParityRunner.js";

const platform = {
  reportTelemetryEvent: async () => undefined,
  reportArmsCustomEvent: async () => undefined,
};

test("conversation telemetry parity catalog keeps the published TDP01 proof", () => {
  const entry = lookupConversationTelemetryParityCase("TDP01");
  assert.deepEqual(entry.proof, ["draft-create-ack", "source-command-link"]);
  assert.equal(entry.operations[0]?.kind, "foreground.attach");
  assert.equal(entry.minimumReportInventory.send_btn, 1);
  assert.throws(
    () => lookupConversationTelemetryParityCase("TDP00"),
    /Unknown conversation telemetry parity case: TDP00/,
  );
});

test("conversation telemetry parity quota and captcha assertions match the published labels", () => {
  assert.deepEqual(collectQuotaParityAssertions(), [
    "quota:daily-exhausted",
    "quota:concurrent-dismissible-nonblocking",
    "quota:provider-limited-message",
    "quota:dismiss-key-instance",
  ]);
  assert.deepEqual(collectCaptchaParityAssertions(), ["captcha:exact-provider"]);
  assert.equal(
    resolveConversationTelemetryParityProviderId({
      taskMeta: { model: `${BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan}/glm-5.2` },
    }),
    BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
  );
});

test("conversation telemetry parity runner returns proof without installing the window hook", async () => {
  const cleanup = installConversationTelemetryParityE2E({ platform, isDesktop: false });
  cleanup();
  assert.equal(globalThis.window?.__zcodeConversationTelemetryParityE2E, undefined);
  const result = await runConversationTelemetryParityCase(platform, "TDP16");
  assert.deepEqual(result.stateAssertions, collectQuotaParityAssertions());
  assert.deepEqual(result.proof, [
    "quota-banner",
    "dismiss",
    "blocking-and-nonblocking",
    "entitlement-refresh",
    "upgrade-context",
    "purchase-events-pruned",
  ]);
  const standard = await runConversationTelemetryParityCase(platform, "TDP01");
  assert.equal(standard.operationCount, 10);
  assert.deepEqual(standard.proof, ["draft-create-ack", "source-command-link"]);
  for (const caseId of [
    "TDP02",
    "TDP03",
    "TDP04",
    "TDP05",
    "TDP06",
    "TDP07",
    "TDP08",
    "TDP09",
    "TDP10",
    "TDP11",
    "TDP12",
    "TDP13",
    "TDP14",
    "TDP15",
    "TDP17",
    "TDP18",
    "TDP19",
  ]) {
    const ran = await runConversationTelemetryParityCase(platform, caseId);
    assert.equal(ran.caseId, caseId);
    assert.ok(ran.proof.length > 0);
  }
  const captcha = await runConversationTelemetryParityCase(platform, "TDP17");
  assert.ok(captcha.stateAssertions.includes("captcha:exact-provider"));
  const isolated = await runConversationTelemetryParityCase(platform, "TDP19");
  assert.ok(isolated.stateAssertions.includes("web:no-final-output"));
});

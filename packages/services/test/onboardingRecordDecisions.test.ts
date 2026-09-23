import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createOnboardingRecordService } from "../src/onboarding/onboardingRecordService.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";

const entry = {
  occupation: "developer",
  interfaceMode: "coding" as const,
  memoryEnabled: false,
  proactiveSuggestionsEnabled: false,
  completedAt: "2026-09-20T00:00:00.000Z",
};

async function withRecordDir(
  run: (readFileJson: () => Promise<Record<string, unknown>>) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zcode-onboarding-"));
  setDataBaseDir(dir);
  try {
    await run(async () =>
      JSON.parse(await readFile(join(getAppConfigDir(), "onboarding-record.json"), "utf8")),
    );
  } finally {
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
}

test("dismiss writes one user_closed decision and does not replace an entry", async () => {
  await withRecordDir(async (readFileJson) => {
    let userId: string | null = "user-a";
    const service = createOnboardingRecordService({
      loadUserId: async () => userId,
      hasExistingLocalTask: async () => false,
    });

    assert.equal(await service.shouldOnboard("device-1"), true);
    await service.dismissOnboarding("device-1");
    await service.dismissOnboarding("device-1");
    const dismissed = await readFileJson();
    assert.equal(dismissed.version, 2);
    assert.equal(dismissed.deviceMid, "device-1");
    assert.deepEqual(dismissed.entries, []);
    const decisions = dismissed.decisions as Array<Record<string, unknown>>;
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0]?.status, "dismissed");
    assert.equal(decisions[0]?.reason, "user_closed");
    assert.equal(decisions[0]?.userId, "user-a");
    assert.equal(typeof decisions[0]?.decidedAt, "string");
    assert.equal(await service.shouldOnboard("device-1"), false);

    await service.appendRecord("device-1", entry);
    const answered = await readFileJson();
    assert.equal((answered.entries as unknown[]).length, 1);
    assert.deepEqual(answered.decisions, []);
    const beforeClose = JSON.stringify(answered);
    await service.dismissOnboarding("device-1");
    assert.equal(JSON.stringify(await readFileJson()), beforeClose);
  });
});

test("an existing local task records existing_local_user once", async () => {
  await withRecordDir(async (readFileJson) => {
    const service = createOnboardingRecordService({
      loadUserId: async () => null,
      hasExistingLocalTask: async () => true,
    });
    assert.equal(await service.shouldOnboard("device-2"), false);
    assert.equal(await service.shouldOnboard("device-2"), false);
    const file = await readFileJson();
    const decisions = file.decisions as Array<Record<string, unknown>>;
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0]?.userId, null);
    assert.equal(decisions[0]?.status, "existing_local_user");
    assert.equal(decisions[0]?.reason, "existing_local_task");
  });
});

test("version 1 files gain an empty decision list and anonymous decisions can be claimed", async () => {
  await withRecordDir(async (readFileJson) => {
    const filePath = join(getAppConfigDir(), "onboarding-record.json");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(getAppConfigDir(), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        deviceMid: "device-3",
        entries: [],
      }),
    );
    const service = createOnboardingRecordService({
      loadUserId: async () => "user-b",
      hasExistingLocalTask: async () => false,
    });
    assert.equal(await service.shouldOnboard("device-3"), true);
    const upgraded = await service.getRecords();
    assert.equal(upgraded?.version, 2);
    assert.deepEqual(upgraded?.decisions, []);

    await writeFile(
      filePath,
      JSON.stringify({
        version: 2,
        deviceMid: "device-3",
        entries: [],
        decisions: [
          {
            userId: null,
            status: "dismissed",
            reason: "user_closed",
            decidedAt: "2026-09-20T00:00:00.000Z",
          },
        ],
      }),
    );
    await service.claimAnonymousRecord();
    const claimed = await readFileJson();
    assert.equal((claimed.decisions as Array<{ userId: string }>)[0]?.userId, "user-b");
    await service.claimAnonymousRecord();
    const again = await readFileJson();
    assert.equal((again.decisions as Array<{ userId: string }>)[0]?.userId, "user-b");
  });
});

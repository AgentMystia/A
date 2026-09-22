import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAppConfigDir } from "../paths.js";
import { BOT_RUNTIME_LOCKS_DIRECTORY_NAME } from "./botsPaths.js";
import type { BotConfigEntry, BotProviderId } from "@zcode/shared";

const LOCK_HELD_TTL_MS = 30_000;
const LEASE_TOUCH_MS = 10_000;

export interface BotRuntimeLock {
  release(): Promise<void>;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function isBotRuntimeLockConflictError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

export function getBotRuntimeLockPath(kind: string, key: string): string {
  const digest = createHash("sha256").update(key.trim()).digest("hex");
  return join(getAppConfigDir(), BOT_RUNTIME_LOCKS_DIRECTORY_NAME, kind, `${digest}.lock`);
}

async function readBotRuntimeLockOwner(
  lockPath: string,
): Promise<{ pid: number; botId: string; nonce: string; createdAt: number } | null> {
  try {
    const raw = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8"));
    return typeof raw.pid === "number" && typeof raw.botId === "string" && typeof raw.nonce === "string"
      ? {
          pid: raw.pid,
          botId: raw.botId,
          nonce: raw.nonce,
          createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
        }
      : null;
  } catch {
    return null;
  }
}

async function readBotRuntimeLockLeaseAt(lockPath: string, nonce: string): Promise<number> {
  try {
    return (await stat(join(lockPath, `lease-${nonce}`))).mtimeMs;
  } catch {
    return 0;
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
}

async function removeBotRuntimeLockPath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/** 发布包 host `acquireBotRuntimeLock`：pending 目录 rename 成 lock，冲突时看租约是否过期。 */
export async function acquireBotRuntimeLock(
  kind: string,
  key: string,
  botId: string,
): Promise<BotRuntimeLock | null> {
  const lockPath = getBotRuntimeLockPath(kind, key);
  const owner = {
    pid: process.pid,
    botId,
    nonce: randomBytes(8).toString("hex"),
    createdAt: Date.now(),
  };
  const leasePath = join(lockPath, `lease-${owner.nonce}`);
  await mkdir(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const pending = `${lockPath}.${owner.nonce}.pending`;
    try {
      await mkdir(pending);
      await writeFile(join(pending, "owner.json"), `${JSON.stringify(owner)}\n`);
      await writeFile(join(pending, `lease-${owner.nonce}`), "");
      try {
        await rename(pending, lockPath);
      } catch (error) {
        if (!isBotRuntimeLockConflictError(error) || !(await stat(lockPath).catch(() => null))) {
          throw error;
        }
        const current = await readBotRuntimeLockOwner(lockPath);
        if (current) {
          const leaseAt = await readBotRuntimeLockLeaseAt(lockPath, current.nonce);
          const age = Date.now() - leaseAt;
          if (isProcessAlive(current.pid) && leaseAt > 0 && age < LOCK_HELD_TTL_MS) {
            return null;
          }
        }
        await removeBotRuntimeLockPath(lockPath);
        continue;
      }
      let touching = false;
      const timer = setInterval(() => {
        if (touching) {
          return;
        }
        touching = true;
        const now = new Date();
        void utimes(leasePath, now, now)
          .catch(() => undefined)
          .finally(() => {
            touching = false;
          });
      }, LEASE_TOUCH_MS);
      timer.unref();
      return {
        async release() {
          clearInterval(timer);
          const current = await readBotRuntimeLockOwner(lockPath);
          if (current?.pid === owner.pid && current.botId === owner.botId && current.nonce === owner.nonce) {
            await removeBotRuntimeLockPath(lockPath);
          }
        },
      };
    } finally {
      await removeBotRuntimeLockPath(pending).catch(() => undefined);
    }
  }
  return null;
}

export async function acquireTelegramPollingLock(
  credential: string,
  botId: string,
): Promise<BotRuntimeLock | null> {
  return acquireBotRuntimeLock("telegram-polling", credential, botId);
}

export async function acquireWeixinPollingLock(
  credential: string,
  botId: string,
): Promise<BotRuntimeLock | null> {
  return acquireBotRuntimeLock("weixin-polling", credential, botId);
}

export async function acquireFeishuWebSocketLock(
  bot: Pick<BotConfigEntry, "id" | "provider" | "feishuAppId"> & { provider: BotProviderId },
): Promise<BotRuntimeLock | null> {
  return acquireBotRuntimeLock(`${bot.provider}-websocket`, bot.feishuAppId?.trim() ?? "", bot.id);
}

export function isLockNotFound(error: unknown): boolean {
  return isNotFound(error);
}

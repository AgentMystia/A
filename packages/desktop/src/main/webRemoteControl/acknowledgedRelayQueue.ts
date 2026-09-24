import { WEB_REMOTE_CONTROL_RPC_LIMITS } from "@zcode/shared";

export const ACKNOWLEDGED_RELAY_DEFAULTS = {
  saturationHighWaterMarkBytes: 1024 * 1024,
  saturationLowWaterMarkBytes: 256 * 1024,
  replayBufferMaxBytes: 8 * 1024 * 1024,
  replayBufferGraceMs: 45_000,
  assemblyTimeoutMs: WEB_REMOTE_CONTROL_RPC_LIMITS.assemblyTimeoutMs,
} as const;

export interface AcknowledgedRelayBatch<T> {
  messageSeq: number;
  frames: readonly T[];
  outerBytes: number;
  queuedAt: number;
  nextFrameIndex: number;
}

export class AcknowledgedRelayBatchQueue<
  T extends { messageSeq: number; outerBytes: number; nextFrameIndex: number },
> {
  private storage: Array<T | undefined> = [];
  private headIndex = 0;
  private nextUnsentIndex = 0;

  get oldest(): T | undefined {
    return this.storage[this.headIndex];
  }

  get nextUnsent(): T | undefined {
    return this.storage[this.nextUnsentIndex];
  }

  // 发布包保留这些 getter。其它方法不读它们，压缩后仍留在类上。
  get activeCount(): number {
    return this.storage.length - this.headIndex;
  }

  get retainedStorageSlots(): number {
    return this.storage.length;
  }

  get retainedBatchReferenceCount(): number {
    let count = 0;
    for (const batch of this.storage) if (batch) count += 1;
    return count;
  }

  get retainedPayloadBytes(): number {
    let bytes = 0;
    for (const batch of this.storage) if (batch) bytes += batch.outerBytes;
    return bytes;
  }

  append(batch: T): void {
    this.storage.push(batch);
  }

  advanceUnsent(): void {
    if (this.nextUnsentIndex < this.storage.length) this.nextUnsentIndex += 1;
  }

  resetReplay(): void {
    for (let index = this.headIndex; index < this.storage.length; index += 1) {
      const batch = this.storage[index];
      if (batch) batch.nextFrameIndex = 0;
    }
    this.nextUnsentIndex = this.headIndex;
  }

  releaseThrough(messageSeq: number): { releasedBytes: number; releasedCount: number } {
    let releasedBytes = 0;
    let releasedCount = 0;
    while (this.headIndex < this.storage.length) {
      const batch = this.storage[this.headIndex];
      if (!batch || batch.messageSeq > messageSeq) break;
      releasedBytes += batch.outerBytes;
      releasedCount += 1;
      this.storage[this.headIndex] = undefined;
      this.headIndex += 1;
    }
    this.nextUnsentIndex = Math.max(this.nextUnsentIndex, this.headIndex);
    this.compactReleasedPrefix();
    return { releasedBytes, releasedCount };
  }

  clear(): void {
    this.storage = [];
    this.headIndex = 0;
    this.nextUnsentIndex = 0;
  }

  private compactReleasedPrefix(): void {
    if (this.headIndex < 1024 || this.headIndex * 2 < this.storage.length) return;
    const released = this.headIndex;
    this.storage = this.storage.slice(released);
    this.nextUnsentIndex = Math.max(0, this.nextUnsentIndex - released);
    this.headIndex = 0;
  }
}

function requirePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function requireNonnegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative safe integer`);
  }
  return value;
}

export function resolveAcknowledgedRelayLimits(input: {
  saturationHighWaterMarkBytes?: number;
  saturationLowWaterMarkBytes?: number;
  replayBufferMaxBytes?: number;
  replayBufferGraceMs?: number;
  assemblyTimeoutMs?: number;
}): {
  highWaterMarkBytes: number;
  lowWaterMarkBytes: number;
  replayBufferMaxBytes: number;
  replayBufferGraceMs: number;
  assemblyTimeoutMs: number;
} {
  const highWaterMarkBytes = requirePositiveSafeInteger(
    input.saturationHighWaterMarkBytes ?? ACKNOWLEDGED_RELAY_DEFAULTS.saturationHighWaterMarkBytes,
    "saturationHighWaterMarkBytes",
  );
  const lowWaterMarkBytes = requireNonnegativeSafeInteger(
    input.saturationLowWaterMarkBytes ?? ACKNOWLEDGED_RELAY_DEFAULTS.saturationLowWaterMarkBytes,
    "saturationLowWaterMarkBytes",
  );
  if (lowWaterMarkBytes > highWaterMarkBytes) {
    throw new Error("saturationLowWaterMarkBytes must not exceed high watermark");
  }
  return {
    highWaterMarkBytes,
    lowWaterMarkBytes,
    replayBufferMaxBytes: Math.min(
      requirePositiveSafeInteger(
        input.replayBufferMaxBytes ?? ACKNOWLEDGED_RELAY_DEFAULTS.replayBufferMaxBytes,
        "replayBufferMaxBytes",
      ),
      ACKNOWLEDGED_RELAY_DEFAULTS.replayBufferMaxBytes,
    ),
    replayBufferGraceMs: Math.min(
      requirePositiveSafeInteger(
        input.replayBufferGraceMs ?? ACKNOWLEDGED_RELAY_DEFAULTS.replayBufferGraceMs,
        "replayBufferGraceMs",
      ),
      ACKNOWLEDGED_RELAY_DEFAULTS.replayBufferGraceMs,
    ),
    assemblyTimeoutMs: Math.min(
      requirePositiveSafeInteger(
        input.assemblyTimeoutMs ?? ACKNOWLEDGED_RELAY_DEFAULTS.assemblyTimeoutMs,
        "assemblyTimeoutMs",
      ),
      ACKNOWLEDGED_RELAY_DEFAULTS.assemblyTimeoutMs,
    ),
  };
}

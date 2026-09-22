export function safeWebRemoteControlRandom(random: () => number = Math.random): number {
  const value = random();
  return Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0;
}

export function getWebRemoteControlHeartbeatJitterMs(
  intervalMs = 10_000,
  requested?: number,
): number {
  const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? Math.floor(intervalMs) : 10_000;
  const defaultJitter = Math.min(2_000, Math.floor(interval * 0.2));
  const jitter = requested ?? defaultJitter;
  if (!Number.isFinite(jitter) || jitter <= 0) return 0;
  return Math.min(Math.floor(jitter), Math.max(0, interval - 1));
}

export function getWebRemoteControlHeartbeatDelayMs(
  intervalMs = 10_000,
  requestedJitter?: number,
  random: () => number = Math.random,
): number {
  const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? Math.floor(intervalMs) : 10_000;
  const jitter = getWebRemoteControlHeartbeatJitterMs(interval, requestedJitter);
  const low = Math.max(1, interval - jitter);
  const high = interval + jitter;
  return low + Math.floor(safeWebRemoteControlRandom(random) * (high - low + 1));
}

export function getWebRemoteControlReconnectJitterMs(
  delayMs = 2_000,
  random: () => number = Math.random,
): number {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return 0;
  const delay = Math.floor(delayMs);
  return Math.floor(safeWebRemoteControlRandom(random) * (delay + 1));
}

import { useEffect, useState } from "react";
import type { WebRemoteControlStatus } from "@zcode/shared";

import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { logger } from "@/logger.js";

import { sameWebRemoteControlPollStatus } from "./webRemoteControlFormat.js";

const IDLE_STATUS: WebRemoteControlStatus = { status: "idle" };

export function useWebRemoteControlStatus(options?: {
  enabled?: boolean;
  intervalMs?: number;
}): WebRemoteControlStatus {
  const enabled = options?.enabled ?? true;
  const intervalMs = options?.intervalMs ?? 1000;
  const platform = useOptionalPlatform();
  const [status, setStatus] = useState<WebRemoteControlStatus>(IDLE_STATUS);

  useEffect(() => {
    if (!enabled || !platform?.getWebRemoteControlStatus) {
      setStatus(IDLE_STATUS);
      return;
    }
    let cancelled = false;
    const apply = (next: WebRemoteControlStatus) => {
      if (cancelled) return;
      setStatus((current) => (sameWebRemoteControlPollStatus(current, next) ? current : next));
    };
    const sync = async () => {
      try {
        apply(await platform.getWebRemoteControlStatus!());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.debug("[useWebRemoteControlStatus] 同步 Web 远程控制状态失败", { error: message });
      }
    };
    void sync();
    const dispose = platform.onWebRemoteControlStatusChanged?.(apply);
    const timer = window.setInterval(() => {
      void sync();
    }, intervalMs);
    return () => {
      cancelled = true;
      dispose?.();
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs, platform]);

  return status;
}

import { WEB_REMOTE_CONTROL_RPC_LIMITS, type WebRemoteControlRpcIdentity } from "@zcode/shared";

export interface AcknowledgedRelayFault {
  reasonCode: string;
  terminal: boolean;
  messageSeq?: number;
}

interface DeadlineSelection {
  deadline: number;
  fault: AcknowledgedRelayFault;
}

export class AcknowledgedRelayDeadline {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    private readonly graceMs: number,
    private readonly now: () => number,
    private readonly readState: () => {
      oldestData: { queuedAt: number; messageSeq: number } | null;
      pendingAck: { queuedAt: number; messageSeq: number } | null;
    },
    private readonly onExpired: (fault: AcknowledgedRelayFault) => void,
  ) {}

  check(): boolean {
    if (this.disposed) return false;
    const selected = this.select();
    if (!selected || this.now() < selected.deadline) return false;
    this.onExpired(selected.fault);
    return true;
  }

  refresh(): void {
    if (this.disposed) return;
    this.clear();
    const selected = this.select();
    if (!selected) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        if (!this.check()) this.refresh();
      },
      Math.max(0, selected.deadline - this.now()),
    );
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  private select(): DeadlineSelection | null {
    const state = this.readState();
    const oldest = state.oldestData;
    const pending = state.pendingAck;
    if (!oldest && !pending) return null;
    if (pending && (!oldest || pending.queuedAt <= oldest.queuedAt)) {
      return {
        deadline: pending.queuedAt + this.graceMs + 1,
        fault: {
          reasonCode: "remote.rpcFrame.ackGraceExceeded",
          terminal: true,
          messageSeq: pending.messageSeq,
        },
      };
    }
    return {
      deadline: oldest!.queuedAt + this.graceMs + 1,
      fault: {
        reasonCode: "remote.rpcFrame.replayGraceExceeded",
        terminal: true,
        messageSeq: oldest!.messageSeq,
      },
    };
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export function relayIdentity(input: {
  bridgeSessionId: string;
  bridgeGeneration?: number;
  recoveryId?: string;
}): WebRemoteControlRpcIdentity {
  return {
    bridgeSessionId: input.bridgeSessionId,
    ...(input.bridgeGeneration === undefined ? {} : { bridgeGeneration: input.bridgeGeneration }),
    ...(input.recoveryId === undefined ? {} : { recoveryId: input.recoveryId }),
  };
}

export function rawIdentityMatches(identity: WebRemoteControlRpcIdentity, value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as WebRemoteControlRpcIdentity;
  return (
    record.bridgeSessionId === identity.bridgeSessionId &&
    record.bridgeGeneration === identity.bridgeGeneration &&
    record.recoveryId === identity.recoveryId
  );
}

export function isRawTransportCandidate(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { zcode_type?: unknown }).zcode_type;
  return type === "rpc-frame" || type === "rpc-frame-ack";
}

export function measureAcknowledgedRelayBatchBytes(
  frames: readonly unknown[],
  measure: (frame: unknown) => number,
): number {
  let total = 0;
  for (const frame of frames) {
    const bytes = measure(frame);
    if (
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      bytes > WEB_REMOTE_CONTROL_RPC_LIMITS.maxPhysicalFrameBytes
    ) {
      throw new Error("invalid final envelope byte count");
    }
    total += bytes;
  }
  return total;
}

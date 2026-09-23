import { Emitter, VSBuffer, type IDisposable } from "@zcode/rpc";
import {
  encodeWebRemoteControlRpcTransportMessage,
  measureWebRemoteControlRpcRelayEnvelopeBytes,
  parseWebRemoteControlRpcTransportPayload,
  WebRemoteControlRpcTransportAssembler,
  WebRemoteControlRpcTransportEncodingError,
  type WebRemoteControlRpcIdentity,
  type WebRemoteControlRpcTransportPayload,
} from "@zcode/shared";
import {
  AcknowledgedRelayBatchQueue,
  resolveAcknowledgedRelayLimits,
  type AcknowledgedRelayBatch,
} from "./acknowledgedRelayQueue.js";
import {
  AcknowledgedRelayDeadline,
  isRawTransportCandidate,
  measureAcknowledgedRelayBatchBytes,
  rawIdentityMatches,
  relayIdentity,
  type AcknowledgedRelayFault,
} from "./acknowledgedRelaySupport.js";
export interface AcknowledgedRelayProtocolOptions {
  bridgeSessionId: string;
  bridgeGeneration?: number;
  recoveryId?: string;
  sendFrame: (frame: WebRemoteControlRpcTransportPayload) => boolean | void;
  measureFrameBytes?: (frame: unknown) => number;
  saturationHighWaterMarkBytes?: number;
  saturationLowWaterMarkBytes?: number;
  replayBufferMaxBytes?: number;
  replayBufferGraceMs?: number;
  assemblyTimeoutMs?: number;
  now?: () => number;
}

type RelayBatch = AcknowledgedRelayBatch<WebRemoteControlRpcTransportPayload>;

export class AcknowledgedRelayProtocol {
  private readonly identity: WebRemoteControlRpcIdentity;
  private readonly sendFrame: AcknowledgedRelayProtocolOptions["sendFrame"];
  private readonly measureFrameBytes: (frame: unknown) => number;
  private readonly highWaterMarkBytes: number;
  private readonly lowWaterMarkBytes: number;
  private readonly replayBufferMaxBytes: number;
  private readonly assemblyTimeoutMs: number;
  private readonly now: () => number;
  private readonly deadline: AcknowledgedRelayDeadline;
  private readonly onMessageEmitter = new Emitter<VSBuffer>();
  private readonly saturatedEmitter = new Emitter<void>();
  private readonly drainedEmitter = new Emitter<void>();
  private readonly degradedEmitter = new Emitter<AcknowledgedRelayFault>();
  private assembler: WebRemoteControlRpcTransportAssembler | null;
  private readonly outboundBatches = new AcknowledgedRelayBatchQueue<RelayBatch>();
  private queuedInbound: unknown[] = [];
  private pendingAckMessageSeq: number | null = null;
  private pendingAckQueuedAt: number | null = null;
  private nextPhysicalSeq = 1;
  private nextMessageSeq = 1;
  private highestFullySentMessageSeq = 0;
  private lastAckedMessageSeq = 0;
  private unacknowledgedByteCount = 0;
  private saturated = false;
  private disposed = false;
  private degraded = false;
  private flushing = false;
  private outboundCallDepth = 0;
  private assemblyTimer: ReturnType<typeof setTimeout> | undefined;

  readonly onSaturated = this.saturatedEmitter.event;
  readonly onDrained = this.drainedEmitter.event;
  readonly onDegraded = this.degradedEmitter.event;
  readonly protocol: {
    onMessage: (listener: (buffer: VSBuffer) => void) => IDisposable;
    send: (buffer: VSBuffer) => void;
    drain: () => Promise<void>;
  };

  constructor(options: AcknowledgedRelayProtocolOptions) {
    this.identity = relayIdentity(options);
    this.sendFrame = options.sendFrame;
    this.measureFrameBytes =
      options.measureFrameBytes ?? measureWebRemoteControlRpcRelayEnvelopeBytes;
    const limits = resolveAcknowledgedRelayLimits(options);
    this.highWaterMarkBytes = limits.highWaterMarkBytes;
    this.lowWaterMarkBytes = limits.lowWaterMarkBytes;
    this.replayBufferMaxBytes = limits.replayBufferMaxBytes;
    this.assemblyTimeoutMs = limits.assemblyTimeoutMs;
    this.now = options.now ?? Date.now;
    this.deadline = new AcknowledgedRelayDeadline(
      limits.replayBufferGraceMs,
      this.now,
      () => {
        const oldest = this.outboundBatches.oldest;
        return {
          oldestData: oldest ? { queuedAt: oldest.queuedAt, messageSeq: oldest.messageSeq } : null,
          pendingAck:
            this.pendingAckQueuedAt === null || this.pendingAckMessageSeq === null
              ? null
              : { queuedAt: this.pendingAckQueuedAt, messageSeq: this.pendingAckMessageSeq },
        };
      },
      (fault) => this.enterDegraded(fault),
    );
    this.assembler = this.createAssembler();
    this.protocol = {
      onMessage: this.onMessageEmitter.event,
      send: (buffer) => this.reserveMessage(buffer.buffer),
      drain: () => Promise.resolve(),
    };
  }

  get unacknowledgedBytes(): number {
    return this.unacknowledgedByteCount;
  }

  getBridgeSessionId(): string {
    return this.identity.bridgeSessionId;
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  markDegraded(reasonCode = "remote.rpcFrame.manuallyDegraded"): void {
    this.enterDegraded({ reasonCode, terminal: true });
  }

  private createAssembler(): WebRemoteControlRpcTransportAssembler {
    return new WebRemoteControlRpcTransportAssembler({
      identity: this.identity,
      timeoutMs: this.assemblyTimeoutMs,
      now: this.now,
    });
  }

  private reserveMessage(bytes: Uint8Array): void {
    if (this.disposed || this.degraded || this.deadline.check()) return;
    let frames: readonly WebRemoteControlRpcTransportPayload[];
    try {
      frames = encodeWebRemoteControlRpcTransportMessage(bytes, {
        ...this.identity,
        firstPhysicalSeq: this.nextPhysicalSeq,
        messageSeq: this.nextMessageSeq,
      });
    } catch (error) {
      this.enterDegraded({
        reasonCode:
          error instanceof WebRemoteControlRpcTransportEncodingError
            ? error.reasonCode
            : "remote.rpcFrame.encodingFailed",
        terminal: true,
      });
      return;
    }
    let outerBytes = 0;
    try {
      outerBytes = measureAcknowledgedRelayBatchBytes(frames, this.measureFrameBytes);
    } catch {
      this.enterDegraded({ reasonCode: "remote.rpcFrame.outerMeterFailed", terminal: true });
      return;
    }
    if (this.unacknowledgedByteCount + outerBytes > this.replayBufferMaxBytes) {
      this.enterDegraded({
        reasonCode: "remote.rpcFrame.replayBufferExceeded",
        terminal: true,
        messageSeq: this.nextMessageSeq,
      });
      return;
    }
    const messageSeq = this.nextMessageSeq;
    const last = frames.at(-1);
    if (!last || last.zcode_type !== "rpc-frame") return;
    this.outboundBatches.append({
      messageSeq,
      frames,
      outerBytes,
      queuedAt: this.now(),
      nextFrameIndex: 0,
    });
    this.unacknowledgedByteCount += outerBytes;
    this.nextMessageSeq += 1;
    this.nextPhysicalSeq = last.seq + 1;
    this.updateSaturationAfterReserve();
    this.deadline.refresh();
    this.flushPendingFrames();
  }

  private updateSaturationAfterReserve(): void {
    if (!this.saturated && this.unacknowledgedByteCount > this.highWaterMarkBytes) {
      this.saturated = true;
      this.saturatedEmitter.fire();
    }
  }

  private invokeSend(frame: WebRemoteControlRpcTransportPayload): boolean {
    this.outboundCallDepth += 1;
    try {
      return this.sendFrame(frame) !== false;
    } catch {
      this.enterDegraded({ reasonCode: "remote.rpcFrame.sendFailed", terminal: true });
      return false;
    } finally {
      this.outboundCallDepth -= 1;
    }
  }

  flushPendingFrames(): boolean {
    if (this.disposed || this.degraded || this.deadline.check() || this.flushing) return false;
    this.flushing = true;
    let sentAll = true;
    try {
      while (!this.disposed && !this.degraded) {
        if (this.deadline.check()) {
          sentAll = false;
          break;
        }
        if (this.pendingAckMessageSeq !== null) {
          const ackSeq = this.pendingAckMessageSeq;
          if (
            !this.invokeSend({
              zcode_type: "rpc-frame-ack",
              ...this.identity,
              ackMessageSeq: ackSeq,
            }) ||
            this.degraded ||
            this.disposed
          ) {
            sentAll = false;
            break;
          }
          if (this.pendingAckMessageSeq === ackSeq) {
            this.pendingAckMessageSeq = null;
            this.pendingAckQueuedAt = null;
            this.deadline.refresh();
          }
          this.drainQueuedInbound();
          continue;
        }
        const batch = this.outboundBatches.nextUnsent;
        if (!batch) break;
        const frame = batch.frames[batch.nextFrameIndex];
        if (!frame || !this.invokeSend(frame) || this.degraded || this.disposed) {
          sentAll = false;
          break;
        }
        batch.nextFrameIndex += 1;
        if (batch.nextFrameIndex === batch.frames.length) {
          this.highestFullySentMessageSeq = Math.max(
            this.highestFullySentMessageSeq,
            batch.messageSeq,
          );
          this.outboundBatches.advanceUnsent();
        }
        this.drainQueuedInbound();
      }
    } finally {
      this.flushing = false;
    }
    if (!this.disposed && !this.degraded) this.drainQueuedInbound();
    return sentAll && this.pendingAckMessageSeq === null;
  }

  replayUnacknowledged(): boolean {
    if (this.disposed || this.degraded || this.deadline.check()) return false;
    this.outboundBatches.resetReplay();
    return this.flushPendingFrames();
  }

  acceptPayload(payload: unknown): boolean {
    if (
      this.disposed ||
      this.degraded ||
      !isRawTransportCandidate(payload) ||
      !rawIdentityMatches(this.identity, payload)
    ) {
      return false;
    }
    if (this.deadline.check()) return true;
    if (this.outboundCallDepth > 0) {
      this.queuedInbound.push(payload);
      return true;
    }
    this.processInbound(payload);
    return true;
  }

  private drainQueuedInbound(): void {
    if (this.outboundCallDepth > 0 || this.disposed || this.degraded) return;
    while (this.queuedInbound.length > 0 && !this.disposed && !this.degraded) {
      this.processInbound(this.queuedInbound.shift());
    }
  }

  private processInbound(payload: unknown): void {
    const parsed = parseWebRemoteControlRpcTransportPayload(payload);
    if (!parsed) {
      this.enterDegraded({ reasonCode: "remote.rpcFrame.invalidPayload", terminal: true });
      return;
    }
    if (parsed.zcode_type === "rpc-frame-ack") {
      this.processAck(parsed.ackMessageSeq);
      return;
    }
    const accepted = this.assembler?.accept(parsed, this.now());
    if (!accepted) return;
    if (accepted.kind === "fault") {
      if (accepted.fault.terminal) this.enterDegraded(accepted.fault);
      return;
    }
    if (accepted.kind === "incomplete") {
      this.scheduleAssemblyTimer();
      return;
    }
    if (accepted.kind === "duplicate") {
      if (accepted.ackMessageSeq !== null) this.queueAck(accepted.ackMessageSeq);
      return;
    }
    this.clearAssemblyTimer();
    try {
      this.onMessageEmitter.fire(VSBuffer.wrap(accepted.bytes));
    } catch {
      this.enterDegraded({
        reasonCode: "remote.rpcFrame.deliveryFailed",
        terminal: true,
        messageSeq: accepted.messageSeq,
      });
      return;
    }
    this.queueAck(accepted.messageSeq);
  }

  private queueAck(messageSeq: number): void {
    if (this.disposed || this.degraded) return;
    if (this.pendingAckMessageSeq === null) {
      this.pendingAckMessageSeq = messageSeq;
      this.pendingAckQueuedAt = this.now();
      this.deadline.refresh();
    } else if (messageSeq > this.pendingAckMessageSeq) {
      this.pendingAckMessageSeq = messageSeq;
    }
    this.flushPendingFrames();
  }

  private processAck(messageSeq: number): void {
    if (messageSeq <= this.lastAckedMessageSeq) return;
    if (messageSeq > this.highestFullySentMessageSeq) {
      this.enterDegraded({ reasonCode: "remote.rpcFrame.futureAck", terminal: true, messageSeq });
      return;
    }
    const { releasedBytes } = this.outboundBatches.releaseThrough(messageSeq);
    this.unacknowledgedByteCount = Math.max(0, this.unacknowledgedByteCount - releasedBytes);
    this.lastAckedMessageSeq = messageSeq;
    this.deadline.refresh();
    if (this.saturated && this.unacknowledgedByteCount <= this.lowWaterMarkBytes) {
      this.saturated = false;
      this.drainedEmitter.fire();
    }
  }

  private scheduleAssemblyTimer(): void {
    if (this.assemblyTimer || !this.assembler?.nextExpiryAt) return;
    const expiry = this.assembler.nextExpiryAt;
    this.assemblyTimer = setTimeout(
      () => {
        this.assemblyTimer = undefined;
        const expired = this.assembler?.expire(this.now());
        if (expired?.kind === "fault") this.enterDegraded(expired.fault);
      },
      Math.max(0, expiry - this.now()),
    );
  }

  private clearAssemblyTimer(): void {
    if (this.assemblyTimer) clearTimeout(this.assemblyTimer);
    this.assemblyTimer = undefined;
  }

  private enterDegraded(fault: AcknowledgedRelayFault): void {
    if (this.disposed || this.degraded) return;
    this.degraded = true;
    this.deadline.dispose();
    this.clearAssemblyTimer();
    this.outboundBatches.clear();
    this.queuedInbound = [];
    this.pendingAckMessageSeq = null;
    this.pendingAckQueuedAt = null;
    this.unacknowledgedByteCount = 0;
    this.saturated = false;
    this.assembler = null;
    this.degradedEmitter.fire(fault);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.deadline.dispose();
    this.clearAssemblyTimer();
    this.outboundBatches.clear();
    this.queuedInbound = [];
    this.pendingAckMessageSeq = null;
    this.pendingAckQueuedAt = null;
    this.unacknowledgedByteCount = 0;
    this.assembler = null;
    this.onMessageEmitter.dispose();
    this.saturatedEmitter.dispose();
    this.drainedEmitter.dispose();
    this.degradedEmitter.dispose();
  }
}

export function createAcknowledgedWebRemoteControlRelayProtocol(
  options: AcknowledgedRelayProtocolOptions,
): AcknowledgedRelayProtocol {
  return new AcknowledgedRelayProtocol(options);
}

import { crc32WireBytes, decodeWireBase64 } from "./zcode-protocol-v4/wire-binary.js";
import {
  assertPositiveSafeRpcInteger,
  boundedPositiveRpcLimit,
  WEB_REMOTE_CONTROL_RPC_LIMITS,
} from "./webRemoteControlRpcLimits.js";
import { measureWebRemoteControlRpcRelayEnvelopeBytes } from "./webRemoteControlRpcCodec.js";
import {
  hasWebRemoteControlRawIdentityMismatch,
  isCanonicalWebRemoteControlBase64,
  parseWebRemoteControlRpcIdentity,
  sameWebRemoteControlFrameFingerprint,
  sameWebRemoteControlRpcIdentity,
  webRemoteControlFrameFingerprint,
  webRemoteControlRpcFrameSchema,
  type WebRemoteControlFrameFingerprint,
  type WebRemoteControlRpcFrame,
  type WebRemoteControlRpcIdentity,
} from "./webRemoteControlRpcSchema.js";

export type WebRemoteControlRpcFault = {
  reasonCode: string;
  terminal: boolean;
  seq?: number;
  messageSeq?: number;
  expectedSeq: number;
  expectedMessageSeq: number;
};

export type WebRemoteControlRpcAcceptResult =
  | { kind: "fault"; fault: WebRemoteControlRpcFault }
  | { kind: "incomplete"; messageSeq: number; receivedFragments: number }
  | { kind: "duplicate"; ackMessageSeq: number | null }
  | { kind: "complete"; messageSeq: number; bytes: Uint8Array }
  | null;

interface ActiveAssembly {
  messageSeq: number;
  fragmentCount: number;
  messageBytes: number;
  checksum: WebRemoteControlRpcFrame["checksum"];
  firstSeenAt: number;
  stagedBytes: number;
  fragments: Uint8Array[];
  frameFingerprintsBySeq: Map<number, WebRemoteControlFrameFingerprint>;
}

export class WebRemoteControlRpcTransportAssembler {
  private readonly identity: WebRemoteControlRpcIdentity;
  private readonly maxPhysicalFrameBytes: number;
  private readonly maxMessageBytes: number;
  private readonly maxFragments: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private expectedPhysicalSeq: number;
  private expectedMessageSeq: number;
  private lastCompletedMessageSeq: number;
  private physicalSequenceExhausted = false;
  private messageSequenceExhausted = false;
  private settledFrameFingerprintsBySeq = new Map<number, WebRemoteControlFrameFingerprint>();
  private active: ActiveAssembly | null = null;
  private terminalReason: string | null = null;

  constructor(options: {
    identity: WebRemoteControlRpcIdentity;
    initialPhysicalSeq?: number;
    initialMessageSeq?: number;
    maxPhysicalFrameBytes?: number;
    maxMessageBytes?: number;
    maxFragments?: number;
    timeoutMs?: number;
    now?: () => number;
  }) {
    this.identity = parseWebRemoteControlRpcIdentity(options.identity);
    this.expectedPhysicalSeq = options.initialPhysicalSeq ?? 1;
    this.expectedMessageSeq = options.initialMessageSeq ?? 1;
    assertPositiveSafeRpcInteger(this.expectedPhysicalSeq, "remote.rpcFrame.invalidPhysicalSeq");
    assertPositiveSafeRpcInteger(this.expectedMessageSeq, "remote.rpcFrame.invalidMessageSeq");
    this.lastCompletedMessageSeq = this.expectedMessageSeq - 1;
    this.maxPhysicalFrameBytes = boundedPositiveRpcLimit(
      options.maxPhysicalFrameBytes,
      WEB_REMOTE_CONTROL_RPC_LIMITS.maxPhysicalFrameBytes,
      "remote.rpcFrame.invalidPhysicalLimit",
    );
    this.maxMessageBytes = boundedPositiveRpcLimit(
      options.maxMessageBytes,
      WEB_REMOTE_CONTROL_RPC_LIMITS.maxMessageBytes,
      "remote.rpcFrame.invalidMessageLimit",
    );
    this.maxFragments = boundedPositiveRpcLimit(
      options.maxFragments,
      WEB_REMOTE_CONTROL_RPC_LIMITS.maxFragments,
      "remote.rpcFrame.invalidFragmentLimit",
    );
    this.timeoutMs = boundedPositiveRpcLimit(
      options.timeoutMs,
      WEB_REMOTE_CONTROL_RPC_LIMITS.assemblyTimeoutMs,
      "remote.rpcFrame.invalidTimeout",
    );
    this.now = options.now ?? Date.now;
  }

  get nextExpiryAt(): number | null {
    return this.active ? this.active.firstSeenAt + this.timeoutMs : null;
  }

  expire(now = this.now()): WebRemoteControlRpcAcceptResult {
    if (!this.active || now - this.active.firstSeenAt < this.timeoutMs) return null;
    return this.fault("remote.rpcFrame.assemblyTimeout", true, {
      messageSeq: this.active.messageSeq,
    });
  }

  accept(value: unknown, now = this.now()): WebRemoteControlRpcAcceptResult {
    if (hasWebRemoteControlRawIdentityMismatch(this.identity, value)) {
      return this.fault("remote.rpcFrame.identityMismatch", false);
    }
    if (this.terminalReason) return this.fault(this.terminalReason, true);
    const expired = this.expire(now);
    if (expired) return expired;
    const rawBase64 =
      typeof value === "object" && value !== null && "dataBase64" in value
        ? (value as { dataBase64?: unknown }).dataBase64
        : undefined;
    if (
      typeof rawBase64 === "string" &&
      (rawBase64.length > this.maxPhysicalFrameBytes ||
        !isCanonicalWebRemoteControlBase64(rawBase64))
    ) {
      return this.fault("remote.rpcFrame.invalidBase64", true);
    }
    const parsed = webRemoteControlRpcFrameSchema.safeParse(value);
    if (!parsed.success) return this.fault("remote.rpcFrame.invalidMetadata", true);
    const frame = parsed.data;
    if (!sameWebRemoteControlRpcIdentity(this.identity, frame)) {
      return this.fault("remote.rpcFrame.identityMismatch", false, frame);
    }
    if (frame.messageBytes > this.maxMessageBytes) {
      return this.fault("remote.rpcFrame.messageTooLarge", true, frame);
    }
    if (frame.fragmentCount > this.maxFragments) {
      return this.fault("remote.rpcFrame.fragmentLimitExceeded", true, frame);
    }
    if (measureWebRemoteControlRpcRelayEnvelopeBytes(frame) > this.maxPhysicalFrameBytes) {
      return this.fault("remote.rpcFrame.envelopeTooLarge", true, frame);
    }
    const bytes = decodeWireBase64(frame.dataBase64);
    if (!bytes || bytes.byteLength === 0)
      return this.fault("remote.rpcFrame.invalidBase64", true, frame);
    const fingerprint = webRemoteControlFrameFingerprint(frame, bytes);
    const activeFingerprint = this.active?.frameFingerprintsBySeq.get(frame.seq);
    if (activeFingerprint) {
      return sameWebRemoteControlFrameFingerprint(activeFingerprint, fingerprint)
        ? this.duplicate()
        : this.fault("remote.rpcFrame.conflictingDuplicate", true, frame);
    }
    const settled = this.settledFrameFingerprintsBySeq.get(frame.seq);
    if (settled) {
      if (sameWebRemoteControlFrameFingerprint(settled, fingerprint)) return this.duplicate();
      if (this.physicalSequenceExhausted && frame.messageSeq !== settled.messageSeq) {
        return this.fault("remote.rpcFrame.physicalSequenceExhausted", true, frame);
      }
      return this.fault("remote.rpcFrame.conflictingDuplicate", true, frame);
    }
    if (frame.seq < this.expectedPhysicalSeq) return this.duplicate();
    if (this.physicalSequenceExhausted) {
      return this.fault("remote.rpcFrame.physicalSequenceExhausted", true, frame);
    }
    if (this.messageSequenceExhausted && !this.active) {
      return this.fault("remote.rpcFrame.messageSequenceExhausted", true, frame);
    }
    if (frame.seq > this.expectedPhysicalSeq)
      return this.fault("remote.rpcFrame.physicalGap", true, frame);
    if (frame.messageSeq !== this.expectedMessageSeq) {
      return this.fault("remote.rpcFrame.messageGap", true, frame);
    }
    if (frame.seq === Number.MAX_SAFE_INTEGER && frame.fragmentIndex + 1 < frame.fragmentCount) {
      return this.fault("remote.rpcFrame.physicalSequenceExhausted", true, frame);
    }
    const received = this.active?.fragments.length ?? 0;
    if (frame.fragmentIndex !== received)
      return this.fault("remote.rpcFrame.fragmentGap", true, frame);
    if (
      this.active &&
      (frame.fragmentCount !== this.active.fragmentCount ||
        frame.messageBytes !== this.active.messageBytes)
    ) {
      return this.fault("remote.rpcFrame.metadataMismatch", true, frame);
    }
    if (this.active && frame.checksum.value !== this.active.checksum.value) {
      return this.fault("remote.rpcFrame.checksumMismatch", true, frame);
    }
    if (!this.active) {
      this.active = {
        messageSeq: frame.messageSeq,
        fragmentCount: frame.fragmentCount,
        messageBytes: frame.messageBytes,
        checksum: frame.checksum,
        firstSeenAt: now,
        stagedBytes: 0,
        fragments: [],
        frameFingerprintsBySeq: new Map(),
      };
    }
    if (this.active.stagedBytes + bytes.byteLength > this.active.messageBytes) {
      return this.fault("remote.rpcFrame.lengthMismatch", true, frame);
    }
    this.active.fragments.push(bytes);
    this.active.frameFingerprintsBySeq.set(frame.seq, fingerprint);
    this.active.stagedBytes += bytes.byteLength;
    if (frame.seq === Number.MAX_SAFE_INTEGER) this.physicalSequenceExhausted = true;
    else this.expectedPhysicalSeq += 1;
    if (this.active.fragments.length < this.active.fragmentCount) {
      return {
        kind: "incomplete",
        messageSeq: frame.messageSeq,
        receivedFragments: this.active.fragments.length,
      };
    }
    if (this.active.stagedBytes !== this.active.messageBytes) {
      return this.fault("remote.rpcFrame.lengthMismatch", true, frame);
    }
    const assembled = new Uint8Array(this.active.messageBytes);
    let offset = 0;
    for (const fragment of this.active.fragments) {
      assembled.set(fragment, offset);
      offset += fragment.byteLength;
    }
    if (crc32WireBytes(assembled) !== this.active.checksum.value) {
      return this.fault("remote.rpcFrame.checksumMismatch", true, frame);
    }
    const completed = this.active;
    const messageSeq = completed.messageSeq;
    this.settledFrameFingerprintsBySeq = new Map(completed.frameFingerprintsBySeq);
    this.active = null;
    this.lastCompletedMessageSeq = messageSeq;
    if (messageSeq === Number.MAX_SAFE_INTEGER) this.messageSequenceExhausted = true;
    else this.expectedMessageSeq += 1;
    return { kind: "complete", messageSeq, bytes: assembled };
  }

  private duplicate(): WebRemoteControlRpcAcceptResult {
    return {
      kind: "duplicate",
      ackMessageSeq: this.lastCompletedMessageSeq > 0 ? this.lastCompletedMessageSeq : null,
    };
  }

  private fault(
    reasonCode: string,
    terminal: boolean,
    frame?: { seq?: number; messageSeq?: number },
  ): WebRemoteControlRpcAcceptResult {
    if (terminal) {
      this.terminalReason = reasonCode;
      this.active = null;
    }
    return {
      kind: "fault",
      fault: {
        reasonCode,
        terminal,
        ...(typeof frame?.seq === "number" ? { seq: frame.seq } : {}),
        ...(typeof frame?.messageSeq === "number" ? { messageSeq: frame.messageSeq } : {}),
        expectedSeq: this.expectedPhysicalSeq,
        expectedMessageSeq: this.expectedMessageSeq,
      },
    };
  }
}

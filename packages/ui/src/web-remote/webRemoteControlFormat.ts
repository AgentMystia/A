import { resolveWorkspaceKey, type WebRemoteControlStatus } from "@zcode/shared";

type FormatMessage = (descriptor: { id: string }) => string;

interface DeviceInfo {
  browserPlatform?: string;
  name?: string;
  updatedAt?: unknown;
  userAgent?: unknown;
  viewport?: { width?: unknown; height?: unknown };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function readDeviceInfo(value: unknown): DeviceInfo | null {
  const record = readRecord(value);
  if (!record) return null;
  const viewport = readRecord(record.viewport);
  return {
    browserPlatform:
      typeof record.browserPlatform === "string" ? record.browserPlatform : undefined,
    name: typeof record.name === "string" ? record.name : undefined,
    updatedAt: record.updatedAt,
    userAgent: record.userAgent,
    viewport: viewport ? { width: viewport.width, height: viewport.height } : undefined,
  };
}

function readExtra(status: WebRemoteControlStatus): { deviceToken?: unknown; expiresAt?: unknown } {
  const record = status as WebRemoteControlStatus & { deviceToken?: unknown; expiresAt?: unknown };
  return { deviceToken: record.deviceToken, expiresAt: record.expiresAt };
}

export function webRemoteControlStatusLabel(
  status: WebRemoteControlStatus,
  formatMessage: FormatMessage,
): string {
  switch (status.status) {
    case "starting":
      return formatMessage({ id: "webRemoteControl.status.starting" });
    case "running":
      return formatMessage({ id: "webRemoteControl.status.running" });
    case "connecting":
      return formatMessage({ id: "webRemoteControl.status.connecting" });
    case "active":
      return formatMessage({ id: "webRemoteControl.status.active" });
    case "error":
      return formatMessage({ id: "webRemoteControl.status.error" });
    default:
      return formatMessage({ id: "webRemoteControl.status.idle" });
  }
}

export function webRemoteControlStatusDetail(
  status: WebRemoteControlStatus,
  formatMessage: FormatMessage,
): string {
  switch (status.status) {
    case "starting":
      return formatMessage({ id: "webRemoteControl.statusDetail.starting" });
    case "running":
      return formatMessage({ id: "webRemoteControl.statusDetail.running" });
    case "connecting":
      return formatMessage({ id: "webRemoteControl.statusDetail.connecting" });
    case "active":
      return formatMessage({ id: "webRemoteControl.statusDetail.active" });
    case "error":
      return formatMessage({ id: "webRemoteControl.statusDetail.error" });
    default:
      return formatMessage({ id: "webRemoteControl.statusDetail.idle" });
  }
}

export function webRemoteControlFailureLabel(
  failure: WebRemoteControlStatus["failure"],
  formatMessage: FormatMessage,
): string | null {
  if (!failure) return null;
  switch (failure.reason) {
    case "session-not-found":
      return formatMessage({ id: "webRemoteControl.failure.sessionNotFound" });
    case "session-expired":
      return formatMessage({ id: "webRemoteControl.failure.sessionExpired" });
    case "session-conflict":
      return failure.message?.toLowerCase().includes("kicked")
        ? formatMessage({ id: "webRemoteControl.failure.kicked" })
        : formatMessage({ id: "webRemoteControl.failure.sessionConflict" });
    case "workspace-closed":
      return formatMessage({ id: "webRemoteControl.failure.workspaceClosed" });
    case "desktop-disconnected":
      return formatMessage({ id: "webRemoteControl.failure.desktopDisconnected" });
    case "invalid-mobile-connection":
      return formatMessage({ id: "webRemoteControl.failure.invalidMobileConnection" });
    case "desktop-bootstrap-timeout":
      return formatMessage({ id: "webRemoteControl.failure.desktopBootstrapTimeout" });
    case "connection-recovery-timeout":
      return formatMessage({ id: "webRemoteControl.failure.connectionRecoveryTimeout" });
    case "relay-unavailable":
      return formatMessage({ id: "webRemoteControl.failure.relayUnavailable" });
    case "unsupported-action":
      return formatMessage({ id: "webRemoteControl.failure.unsupportedAction" });
    case "unexpected-error":
      return formatMessage({ id: "webRemoteControl.failure.unexpectedError" });
    default:
      return null;
  }
}

export function webRemoteControlDeviceLabel(
  status: WebRemoteControlStatus,
  formatMessage: FormatMessage,
): string {
  const device = readDeviceInfo(status.mobileDeviceInfo);
  return (
    device?.browserPlatform?.trim() ||
    device?.name?.trim() ||
    (status.mobileConnected
      ? formatMessage({ id: "webRemoteControl.statusTag.phone" })
      : status.status === "idle"
        ? formatMessage({ id: "webRemoteControl.status.idle" })
        : status.status === "error"
          ? formatMessage({ id: "webRemoteControl.status.error" })
          : formatMessage({ id: "webRemoteControl.statusTag.ready" }))
  );
}

export function webRemoteControlPhaseDotClass(status: WebRemoteControlStatus): string {
  if (status.status === "error") return "bg-destructive";
  if (status.status === "active") return "bg-success";
  if (status.status === "idle") return "bg-border";
  return "bg-warning";
}

export function webRemoteControlTriggerPresentation(
  status: WebRemoteControlStatus,
  formatMessage: FormatMessage,
): { iconClassName: string; tooltip: string } {
  switch (status.status) {
    case "error":
      return {
        iconClassName: "text-destructive",
        tooltip: formatMessage({ id: "webRemoteControl.triggerStatus.error" }),
      };
    case "active":
      return {
        iconClassName: "text-success",
        tooltip: formatMessage({ id: "webRemoteControl.triggerStatus.connected" }),
      };
    case "starting":
      return {
        iconClassName: "text-warning",
        tooltip: formatMessage({ id: "webRemoteControl.triggerStatus.starting" }),
      };
    case "connecting":
      return {
        iconClassName: "text-warning",
        tooltip: formatMessage({ id: "webRemoteControl.triggerStatus.connecting" }),
      };
    case "running":
      return {
        iconClassName: "text-warning",
        tooltip: formatMessage({ id: "webRemoteControl.triggerStatus.waiting" }),
      };
    default:
      return {
        iconClassName: "text-foreground-subtle",
        tooltip: formatMessage({ id: "webRemoteControl.triggerStatus.idle" }),
      };
  }
}

export function webRemoteControlSessionMatchesWorkspace(
  status: WebRemoteControlStatus,
  workspacePath: string,
  workspaceIdentity: string | undefined,
  remoteSessionId: string | undefined,
): boolean {
  if (status.status === "idle" || status.status === "error") return false;
  const currentPath = status.workspacePath?.trim();
  if (!currentPath) return false;
  const expected = resolveWorkspaceKey({ workspacePath, workspaceIdentity });
  const actual = resolveWorkspaceKey({
    workspacePath: currentPath,
    workspaceIdentity: status.workspaceIdentity,
  });
  if (actual !== expected) return false;
  const expectedSession = remoteSessionId?.trim() || undefined;
  return (status.remoteSessionId?.trim() || undefined) === expectedSession
    ? Boolean(status.windowControlSessionId ?? status.sessionId)
    : false;
}

export function webRemoteControlHasConnectedPhone(status: WebRemoteControlStatus): boolean {
  if (status.status === "idle" || status.status === "error") return false;
  return Boolean(status.mobileConnected && (status.windowControlSessionId ?? status.sessionId));
}

export function sameWebRemoteControlPollStatus(
  current: WebRemoteControlStatus,
  next: WebRemoteControlStatus,
): boolean {
  const currentDevice = readDeviceInfo(current.mobileDeviceInfo);
  const nextDevice = readDeviceInfo(next.mobileDeviceInfo);
  return (
    current.status === next.status &&
    current.sessionId === next.sessionId &&
    current.windowControlSessionId === next.windowControlSessionId &&
    current.mobileConnected === next.mobileConnected &&
    current.mobileViewState?.activeWorkspaceKey === next.mobileViewState?.activeWorkspaceKey &&
    current.mobileViewState?.activeTaskId === next.mobileViewState?.activeTaskId &&
    current.mobileViewState?.updatedAt === next.mobileViewState?.updatedAt &&
    currentDevice?.updatedAt === nextDevice?.updatedAt &&
    currentDevice?.userAgent === nextDevice?.userAgent &&
    currentDevice?.viewport?.width === nextDevice?.viewport?.width &&
    currentDevice?.viewport?.height === nextDevice?.viewport?.height &&
    current.error === next.error &&
    current.failure?.reason === next.failure?.reason &&
    current.failure?.message === next.failure?.message
  );
}

export function sameWebRemoteControlDialogStatus(
  current: WebRemoteControlStatus,
  next: WebRemoteControlStatus,
): boolean {
  const currentDevice = readDeviceInfo(current.mobileDeviceInfo);
  const nextDevice = readDeviceInfo(next.mobileDeviceInfo);
  const currentExtra = readExtra(current);
  const nextExtra = readExtra(next);
  return (
    current.status === next.status &&
    current.sessionId === next.sessionId &&
    current.windowControlSessionId === next.windowControlSessionId &&
    currentExtra.deviceToken === nextExtra.deviceToken &&
    currentExtra.expiresAt === nextExtra.expiresAt &&
    current.mobileConnected === next.mobileConnected &&
    currentDevice?.updatedAt === nextDevice?.updatedAt &&
    currentDevice?.userAgent === nextDevice?.userAgent &&
    currentDevice?.viewport?.width === nextDevice?.viewport?.width &&
    currentDevice?.viewport?.height === nextDevice?.viewport?.height &&
    current.qrUrl === next.qrUrl &&
    current.connectUrl === next.connectUrl &&
    current.workspacePath === next.workspacePath &&
    current.workspaceIdentity === next.workspaceIdentity &&
    current.remoteSessionId === next.remoteSessionId &&
    current.error === next.error &&
    current.failure?.reason === next.failure?.reason &&
    current.failure?.message === next.failure?.message
  );
}

import type { TelemetryEventPayload } from "./telemetry.js";

export type WebRemoteControlTelemetryResult = "success" | "failure";

function resultDetail(
  result: WebRemoteControlTelemetryResult,
  errorCategory?: string,
): Record<string, string> {
  return {
    result,
    error_category: result === "failure" ? (errorCategory ?? "unknown") : "",
  };
}

function event(
  elementName: string,
  eventType: string,
  eventExtraDetail: Record<string, string>,
): TelemetryEventPayload {
  return {
    elementName,
    eventRegion: "web_remote_control",
    eventType,
    eventExtraDetail,
  };
}

export function buildWebRemoteControlEntryViewTelemetry(input: {
  workspaceKind: string;
  remoteKind?: string;
}): TelemetryEventPayload {
  return event("web_remote_control_entry_view", "view", {
    workspace_kind: input.workspaceKind,
    remote_kind: input.remoteKind ?? "",
  });
}

export function buildWebRemoteControlStartResultTelemetry(input: {
  result: WebRemoteControlTelemetryResult;
  errorCategory?: string;
  workspaceKind: string;
  remoteKind?: string;
}): TelemetryEventPayload {
  return event("web_remote_control_start_result", "result", {
    ...resultDetail(input.result, input.errorCategory),
    workspace_kind: input.workspaceKind,
    remote_kind: input.remoteKind ?? "",
  });
}

export function buildWebRemoteControlPairResultTelemetry(input: {
  result: WebRemoteControlTelemetryResult;
  errorCategory?: string;
  pairKind: "initial" | "reconnect";
  workspaceKind: string;
  remoteKind?: string;
}): TelemetryEventPayload {
  return event("web_remote_control_pair_result", "result", {
    ...resultDetail(input.result, input.errorCategory),
    pair_kind: input.pairKind,
    workspace_kind: input.workspaceKind,
    remote_kind: input.remoteKind ?? "",
  });
}

export function buildWebRemoteControlBridgeResultTelemetry(input: {
  result: WebRemoteControlTelemetryResult;
  errorCategory?: string;
  workspaceKind: string;
  remoteKind?: string;
  entryKind: "task" | "home";
}): TelemetryEventPayload {
  return event("web_remote_control_bridge_result", "result", {
    ...resultDetail(input.result, input.errorCategory),
    workspace_kind: input.workspaceKind,
    remote_kind: input.remoteKind ?? "",
    entry_kind: input.entryKind,
  });
}

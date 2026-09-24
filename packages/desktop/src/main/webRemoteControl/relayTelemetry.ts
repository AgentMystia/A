import { recordNetworkObservation } from "../networkTelemetryAggregator.js";

const RELAY_INTERFACE = "web_remote_control.relay";

function classifyWsError(error: unknown): "timeout" | "dns_failure" | "connection_reset" {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (message.includes("dns") || message.includes("getaddrinfo")) return "dns_failure";
  return "connection_reset";
}

export function noteWebRemoteRelayConnectAttempt(
  durationMs: number,
  ok: boolean,
  detail?: { error?: unknown; attempt?: number },
): void {
  recordNetworkObservation({
    transport: "websocket",
    interface: RELAY_INTERFACE,
    durationMs: Math.max(0, Math.round(durationMs)),
    ok,
    errorKind: ok ? undefined : classifyWsError(detail?.error),
    attempt: detail?.attempt ?? 1,
  });
}

export function noteWebRemoteRelayReconnect(): void {
  recordNetworkObservation({
    transport: "websocket",
    interface: RELAY_INTERFACE,
    durationMs: 0,
    ok: false,
    errorKind: "connection_reset",
    attempt: 2,
  });
}

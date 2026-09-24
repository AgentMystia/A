import { z } from "zod";
import { sessionCreateTelemetrySchema } from "./sessionCreateTelemetry.js";
import { sessionWorkflowActivitySchema } from "./zcode-protocol-v4/sessions-index-workflow-activity.js";
import { PROTOCOL_V4_LIMITS } from "./zcode-protocol-v4/core.js";
import {
  webRemoteControlNonnegativeSafeIntegerSchema,
  webRemoteControlRpcAckSchema,
  webRemoteControlRpcFrameSchema,
} from "./webRemoteControlRpcSchema.js";

const nonEmptyString = z.string().trim().min(1);
const transportId = nonEmptyString
  .max(PROTOCOL_V4_LIMITS.transportEnvelopeIdMaxChars)
  .regex(/^[A-Za-z0-9._~-]+$/u);

export const webRemoteControlFailureReasonSchema = z.enum([
  "session-not-found",
  "session-expired",
  "session-conflict",
  "workspace-closed",
  "desktop-disconnected",
  "invalid-mobile-connection",
  "desktop-bootstrap-timeout",
  "connection-recovery-timeout",
  "relay-unavailable",
  "unsupported-action",
  "unexpected-error",
]);

const workspaceSnapshotSchema = z.object({
  workspacePath: nonEmptyString,
  workspaceIdentity: nonEmptyString.optional(),
  remoteSessionId: nonEmptyString.optional(),
  label: nonEmptyString,
  workspacePurpose: z.enum(["project", "conversation"]).optional(),
  kind: z.enum(["local", "remote"]),
  connectionState: z.enum(["connected", "disconnected", "reconnecting"]).optional(),
  lastConnectionError: z.string().optional(),
});

const taskSnapshotSchema = z.object({
  taskId: nonEmptyString,
  title: z.string(),
  workspacePath: nonEmptyString,
  workspaceIdentity: nonEmptyString.optional(),
  remoteSessionId: nonEmptyString.optional(),
  workspaceLabel: nonEmptyString,
  workspaceKind: z.enum(["local", "remote"]),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  provider: z.string().min(1).optional(),
  unreadAt: z.number().finite().optional(),
  displayStatus: z.enum(["idle", "running", "completed", "error"]).optional(),
  hasBackgroundWork: z.boolean().optional(),
  workflowActivity: sessionWorkflowActivitySchema.optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});

const viewStateSchema = z.object({
  activeWorkspaceKey: nonEmptyString.optional(),
  activeTaskId: nonEmptyString.optional(),
  updatedAt: z.number().finite(),
});

const externalBridgeSchema = z.discriminatedUnion("kind", [
  z.object({
    bridgeSessionId: transportId,
    bridgeGeneration: z.number().int().nonnegative().optional(),
    recoveryId: transportId.optional(),
    kind: z.literal("local"),
    workspaceKey: nonEmptyString,
    workspacePath: nonEmptyString,
    initialTaskId: nonEmptyString.optional(),
  }),
  z.object({
    bridgeSessionId: transportId,
    bridgeGeneration: z.number().int().nonnegative().optional(),
    recoveryId: transportId.optional(),
    kind: z.literal("remote"),
    workspaceKey: nonEmptyString,
    workspacePath: nonEmptyString,
    workspaceIdentity: nonEmptyString,
    remoteSessionId: nonEmptyString,
    initialTaskId: nonEmptyString.optional(),
  }),
]);

const bootstrapResultSchema = z.object({
  windowControlSessionId: nonEmptyString,
  desktopAppVersion: nonEmptyString.optional(),
  workspaces: z.array(workspaceSnapshotSchema),
  tasks: z.array(taskSnapshotSchema),
  initialViewState: viewStateSchema.optional(),
  mobileViewState: viewStateSchema.optional(),
});

const workspaceListResultSchema = z.object({
  workspaces: z.array(workspaceSnapshotSchema),
  tasks: z.array(taskSnapshotSchema).optional(),
  activeWorkspaceKey: nonEmptyString.optional(),
  activeTaskId: nonEmptyString.optional(),
});

export const webRemoteControlPlatformMethodSchema = z.enum([
  "isDockerAvailable",
  "listWSLDistros",
  "listDockerContainers",
  "listSSHConfigAliases",
  "loadMcpFromUserDirectory",
  "saveMcpToUserDirectory",
  "migrateLegacyCommonMcp",
]);

const bridgeIdentity = {
  bridgeSessionId: transportId,
  bridgeGeneration: z.number().int().nonnegative().optional(),
  recoveryId: transportId.optional(),
};

export const webRemoteControlAppPayloadSchema = z.union([
  z
    .object({ zcode_type: z.literal("telemetry-report"), event: sessionCreateTelemetrySchema })
    .strict(),
  z.object({ zcode_type: z.literal("bootstrap-request"), requestId: nonEmptyString }),
  z.object({
    zcode_type: z.literal("bootstrap-response"),
    requestId: nonEmptyString,
    success: z.literal(true),
    result: bootstrapResultSchema,
  }),
  z.object({ zcode_type: z.literal("workspace-list-request"), requestId: nonEmptyString }),
  z.object({
    zcode_type: z.literal("workspace-list-response"),
    requestId: nonEmptyString,
    success: z.literal(true),
    result: workspaceListResultSchema,
  }),
  z.object({ zcode_type: z.literal("workspace-list-updated"), result: workspaceListResultSchema }),
  z.object({
    zcode_type: z.literal("workspace-bridge-open"),
    requestId: nonEmptyString,
    ...bridgeIdentity,
    workspaceKey: nonEmptyString,
    taskId: nonEmptyString.optional(),
  }),
  z.object({
    zcode_type: z.literal("workspace-bridge-ready"),
    requestId: nonEmptyString,
    ...bridgeIdentity,
    bridge: externalBridgeSchema,
  }),
  z.object({
    zcode_type: z.literal("workspace-bridge-error"),
    requestId: nonEmptyString,
    bridgeSessionId: transportId.optional(),
    bridgeGeneration: z.number().int().nonnegative().optional(),
    recoveryId: transportId.optional(),
    reason: webRemoteControlFailureReasonSchema,
    error: z.string(),
  }),
  z.object({
    zcode_type: z.literal("workspace-reconnect-request"),
    requestId: nonEmptyString,
    workspaceKey: nonEmptyString,
  }),
  z.object({
    zcode_type: z.literal("workspace-reconnect-response"),
    requestId: nonEmptyString,
    workspaceKey: nonEmptyString,
    success: z.literal(true),
  }),
  z.object({
    zcode_type: z.literal("workspace-reconnect-response"),
    requestId: nonEmptyString,
    workspaceKey: nonEmptyString,
    success: z.literal(false),
    error: z.string(),
  }),
  z.object({
    zcode_type: z.literal("mobile-view-state-update"),
    viewState: viewStateSchema,
    deviceInfo: z
      .object({
        platform: nonEmptyString,
        version: nonEmptyString,
        name: nonEmptyString,
        userAgent: z.string().optional(),
        language: z.string().optional(),
        languages: z.array(z.string()).optional(),
        browserPlatform: z.string().optional(),
        viewport: z
          .object({
            width: z.number().finite(),
            height: z.number().finite(),
            devicePixelRatio: z.number().finite(),
          })
          .optional(),
        screen: z.object({ width: z.number().finite(), height: z.number().finite() }).optional(),
        timezone: z.string().optional(),
        online: z.boolean().optional(),
        updatedAt: z.number().finite(),
      })
      .optional(),
  }),
  z.object({
    zcode_type: z.literal("platform-request"),
    requestId: nonEmptyString,
    method: webRemoteControlPlatformMethodSchema,
    args: z.unknown().optional(),
  }),
  z.object({
    zcode_type: z.literal("platform-response"),
    requestId: nonEmptyString,
    method: webRemoteControlPlatformMethodSchema,
    success: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    zcode_type: z.literal("platform-response"),
    requestId: nonEmptyString,
    method: webRemoteControlPlatformMethodSchema,
    success: z.literal(false),
    error: z.string(),
  }),
  webRemoteControlRpcFrameSchema,
  webRemoteControlRpcAckSchema,
  z.object({
    zcode_type: z.literal("bridge-degraded"),
    bridgeSessionId: transportId,
    bridgeGeneration: webRemoteControlNonnegativeSafeIntegerSchema.optional(),
    recoveryId: transportId.optional(),
    reason: z.enum(["rpc-transport-fault", "rpc-frame-gap", "buffer-overflow", "buffer-timeout"]),
    seq: z.number().int().nonnegative().optional(),
    expectedSeq: z.number().int().nonnegative().optional(),
    droppedCount: z.number().int().nonnegative().optional(),
  }),
  z.object({
    zcode_type: z.literal("app-error"),
    requestId: nonEmptyString.optional(),
    bridgeSessionId: transportId.optional(),
    reason: webRemoteControlFailureReasonSchema,
    error: z.string(),
  }),
  z.object({
    zcode_type: z.literal("mobile-diagnostic"),
    event: z.enum([
      "state-transition",
      "socket-close",
      "socket-error",
      "recover-start",
      "recover-scheduled",
      "pair-status",
      "failure",
    ]),
    timestamp: z.number().int().nonnegative(),
    state: z.string().optional(),
    previousState: z.string().optional(),
    pairStatus: z.enum(["waiting", "matched"]).optional(),
    closeCode: z.number().int().optional(),
    closeReason: z.string().optional(),
    wasClean: z.boolean().optional(),
    wasPaired: z.boolean().optional(),
    failureReason: webRemoteControlFailureReasonSchema.optional(),
    failureMessage: z.string().optional(),
    visibilityState: z.string().optional(),
    online: z.boolean().optional(),
    hiddenDurationMs: z.number().int().nonnegative().optional(),
  }),
]);

export type WebRemoteControlAppPayload = z.infer<typeof webRemoteControlAppPayloadSchema>;

export function parseWebRemoteControlAppPayload(value: unknown): WebRemoteControlAppPayload | null {
  const parsed = webRemoteControlAppPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const webRemoteControlWorkspaceSyncSchema = z.array(workspaceSnapshotSchema);
export const webRemoteControlTaskSyncSchema = z.array(taskSnapshotSchema);

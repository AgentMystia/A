import { shouldExposeE2EStoreBridge } from "@/lib/e2eStoreBridge.js";
import {
  runConversationTelemetryParityCase,
  type ConversationTelemetryParityPlatform,
  type ConversationTelemetryParityRunResult,
} from "@/v4/telemetry/conversationTelemetryParityRunner.js";

export interface ConversationTelemetryParityE2EBridge {
  variant: "current";
  run: (caseId: string) => Promise<ConversationTelemetryParityRunResult>;
}

declare global {
  interface Window {
    __zcodeConversationTelemetryParityE2E?: ConversationTelemetryParityE2EBridge;
  }
}

/** 发布包只在桌面且 E2E store bridge 打开时挂上 parity runner。 */
export function installConversationTelemetryParityE2E(input: {
  platform: ConversationTelemetryParityPlatform;
  isDesktop: boolean;
}): () => void {
  if (!input.isDesktop || !shouldExposeE2EStoreBridge()) {
    return () => undefined;
  }
  const bridge: ConversationTelemetryParityE2EBridge = {
    variant: "current",
    run: (caseId) => runConversationTelemetryParityCase(input.platform, caseId),
  };
  window.__zcodeConversationTelemetryParityE2E = bridge;
  return () => {
    if (window.__zcodeConversationTelemetryParityE2E === bridge) {
      delete window.__zcodeConversationTelemetryParityE2E;
    }
  };
}

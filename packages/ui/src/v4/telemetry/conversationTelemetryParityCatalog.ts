import { buildEarlyConversationTelemetryParityCases } from "@/v4/telemetry/conversationTelemetryParityCasesEarly.js";
import { buildLateConversationTelemetryParityCases } from "@/v4/telemetry/conversationTelemetryParityCasesLate.js";
import { buildMidConversationTelemetryParityCases } from "@/v4/telemetry/conversationTelemetryParityCasesMid.js";
import type { ConversationTelemetryParityCase } from "@/v4/telemetry/conversationTelemetryParityModel.js";

function buildConversationTelemetryParityCases(): ConversationTelemetryParityCase[] {
  return [
    ...buildEarlyConversationTelemetryParityCases(),
    ...buildMidConversationTelemetryParityCases(),
    ...buildLateConversationTelemetryParityCases(),
  ];
}

const casesById = new Map(
  buildConversationTelemetryParityCases().map((entry) => [entry.caseId, entry]),
);
// 发布包在建表后展开一次 key，保证用例目录在模块初始化时就物化。
void [...casesById.keys()];

export function lookupConversationTelemetryParityCase(
  caseId: string,
): ConversationTelemetryParityCase {
  const entry = casesById.get(caseId);
  if (!entry) {
    throw new Error(`Unknown conversation telemetry parity case: ${caseId}`);
  }
  return entry;
}

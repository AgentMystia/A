function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Claude 导入把父工具 id 放在 `_meta.claudeCode.parentToolUseId`。 */
export function rawClaudeParentToolUseId(payload: object): string | null {
  const meta = asRecord((payload as { _meta?: unknown })._meta);
  const claudeCode = asRecord(meta.claudeCode);
  return stringValue(claudeCode.parentToolUseId) ?? null;
}

/**
 * ZCode Protocol 的父级字段是 parentToolCallId。
 * UI 只消费 parentToolUseId，投影层在这里一次性归一。
 */
export function parentToolUseIdFromToolPayload(payload: Record<string, unknown>): string | null {
  return (
    stringValue(payload.parentToolUseId) ??
    stringValue(payload.parentToolCallId) ??
    rawClaudeParentToolUseId(payload)
  );
}

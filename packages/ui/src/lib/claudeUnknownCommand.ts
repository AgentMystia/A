const CLAUDE_UNKNOWN_COMMAND_PATTERN = /Claude Code 未知命令\s+(\S+?)(?:（参数：([^）]+)）)?。/u;

export interface ClaudeUnknownCommand {
  command: string;
  args?: string;
}

export function parseClaudeUnknownCommandMessage(message: string): ClaudeUnknownCommand | null {
  const match = message.match(CLAUDE_UNKNOWN_COMMAND_PATTERN);
  const command = match?.[1];
  if (!command) {
    return null;
  }
  const args = match[2]?.trim();
  return args ? { command, args } : { command };
}

export function resolveClaudeUnknownCommandMessage(
  error: { code?: string; message: string },
  formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => string,
): string | null {
  if (error.code !== "CLAUDE_UNKNOWN_COMMAND") {
    return null;
  }
  const parsed = parseClaudeUnknownCommandMessage(error.message);
  if (!parsed) {
    return error.message;
  }
  if (parsed.args) {
    return formatMessage(
      { id: "zcode.error.CLAUDE_UNKNOWN_COMMAND_WITH_ARGS" },
      { command: parsed.command, args: parsed.args },
    );
  }
  return formatMessage({ id: "zcode.error.CLAUDE_UNKNOWN_COMMAND" }, { command: parsed.command });
}

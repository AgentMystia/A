import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CLAUDE_SETTINGS_FILE_NAME = "settings.json";

export function resolveUserHomeDir(): string {
  const profile = process.env.USERPROFILE?.trim();
  return profile && profile.length > 0 ? profile : homedir();
}

export function getUserOutputStylesDir(): string {
  return join(resolveUserHomeDir(), ".claude", "output-styles");
}

export function getUserClaudeSettingsPath(): string {
  return join(resolveUserHomeDir(), ".claude", CLAUDE_SETTINGS_FILE_NAME);
}

export function userClaudeDirExists(): boolean {
  return existsSync(join(resolveUserHomeDir(), ".claude"));
}

export function parseMarkdownStyle(
  content: string,
  fileName?: string,
): { name: string; description: string } {
  const nameMatch = content.match(/^name:\s*(.+)$/m);
  const descriptionMatch = content.match(/^description:\s*(.+)$/m);
  let name = nameMatch?.[1]?.trim() ?? "";
  if (!name && fileName) {
    name = fileName.replace(/\.md$/u, "");
  }
  if (!name) {
    name = "Custom Style";
  }
  return { name, description: descriptionMatch?.[1]?.trim() ?? "" };
}

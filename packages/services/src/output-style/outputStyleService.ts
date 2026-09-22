import { existsSync } from "node:fs";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_OUTPUT_STYLES, type OutputStyleConfig, type OutputStyleInfo } from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { IOutputStyleService } from "./outputStyle.js";
import {
  getUserClaudeSettingsPath,
  getUserOutputStylesDir,
  parseMarkdownStyle,
  resolveUserHomeDir,
} from "./outputStylePaths.js";

const log = createServiceLogger("output-style");

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    if (!existsSync(path)) {
      return null;
    }
    return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
  } catch (error) {
    // 发布包 host 对损坏 JSON 记错误后返回 null；这里用服务日志替代 console.error。
    log.error(undefined, `Failed to read JSON file ${path}:`, error);
    return null;
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  try {
    await writeFile(path, JSON.stringify(value, null, 2), "utf-8");
  } catch (error) {
    log.error(undefined, `Failed to write JSON file ${path}:`, error);
    throw error;
  }
}

function renderStyleFile(config: OutputStyleConfig): string {
  return `name: ${config.name}\ndescription: ${config.description}\n\n${config.content}`;
}

export function createOutputStyleService(): IOutputStyleService {
  async function getActiveStyle(): Promise<{ styleId: string | null }> {
    const settings = await readJsonFile(getUserClaudeSettingsPath());
    const styleId = settings?.outputStyle;
    return { styleId: typeof styleId === "string" ? styleId : null };
  }

  async function setActiveStyle(request: { styleId: string | null }): Promise<void> {
    const settingsPath = getUserClaudeSettingsPath();
    const claudeDir = join(resolveUserHomeDir(), ".claude");
    if (!existsSync(claudeDir)) {
      await mkdir(claudeDir, { recursive: true });
    }
    const next = { ...(await readJsonFile(settingsPath)) ?? {}, outputStyle: request.styleId };
    await writeJsonFile(settingsPath, next);
  }

  async function listStyles(): Promise<{ styles: OutputStyleInfo[] }> {
    const custom: OutputStyleInfo[] = [];
    const directory = getUserOutputStylesDir();
    const { styleId } = await getActiveStyle();
    const activeId = styleId ?? "default";
    try {
      await access(directory);
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) {
          continue;
        }
        try {
          const filePath = join(directory, entry.name);
          const content = await readFile(filePath, "utf-8");
          const { name, description } = parseMarkdownStyle(content, entry.name);
          const id = `custom-${entry.name.replace(".md", "")}`;
          custom.push({
            id,
            name,
            description,
            content,
            isBuiltIn: false,
            enabled: id === activeId,
            filePath,
          });
        } catch (error) {
          log.error(undefined, `Failed to read output style file ${entry.name}:`, error);
        }
      }
    } catch {
      // 用户目录不存在时只返回内置 style。
    }
    custom.sort((left, right) => left.name.localeCompare(right.name));
    return {
      styles: [
        ...BUILTIN_OUTPUT_STYLES.map((style) => ({ ...style, enabled: style.id === activeId })),
        ...custom,
      ],
    };
  }

  async function addStyle(request: { config: OutputStyleConfig }): Promise<void> {
    const directory = getUserOutputStylesDir();
    try {
      await mkdir(directory, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
    const fileName = `${request.config.name.toLowerCase().replace(/\s+/g, "-")}.md`;
    await writeFile(join(directory, fileName), renderStyleFile(request.config), "utf-8");
  }

  async function updateStyle(request: { id: string; config: OutputStyleConfig }): Promise<void> {
    const id = request.id.startsWith("custom-") ? request.id.slice(7) : request.id;
    await writeFile(
      join(getUserOutputStylesDir(), `${id}.md`),
      renderStyleFile(request.config),
      "utf-8",
    );
  }

  async function deleteStyle(request: { id: string }): Promise<void> {
    const id = request.id.startsWith("custom-") ? request.id.slice(7) : request.id;
    await rm(join(getUserOutputStylesDir(), `${id}.md`), { force: true });
  }

  async function getUserStylesDirectory(): Promise<{ path: string }> {
    const directory = getUserOutputStylesDir();
    try {
      await mkdir(directory, { recursive: true });
    } catch {
      // 发布包忽略 mkdir 失败，仍返回约定路径。
    }
    return { path: directory };
  }

  return {
    listStyles,
    addStyle,
    updateStyle,
    deleteStyle,
    getUserStylesDirectory,
    setActiveStyle,
    getActiveStyle,
  };
}

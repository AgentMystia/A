import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import { createDefaultBotsConfig } from "@zcode/shared/botsDefaults";
import { botsConfigSchema, botsStateSchema, type BotsConfig, type BotsState } from "@zcode/shared";
import { getAppConfigDir } from "../paths.js";
import { importLegacyBotConfig, importLegacyBotState } from "./botsNormalize.js";
import {
  BOT_CONFIG_LEGACY_FILE_NAME,
  BOT_CONFIG_V3_FILE_NAME,
  BOT_STATE_LEGACY_FILE_NAME,
  BOT_STATE_V2_FILE_NAME,
  BOT_STATE_V3_FILE_NAME,
} from "./botsPaths.js";

async function readOptionalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await atomicWritePrivateTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export class BotsRepo {
  constructor(private readonly configDir: () => string = getAppConfigDir) {}

  async readConfig(): Promise<BotsConfig> {
    const path = join(this.configDir(), BOT_CONFIG_V3_FILE_NAME);
    return withFileLock(path, async () => {
      const current = await readOptionalJson(path);
      if (current !== undefined) {
        return botsConfigSchema.parse(current);
      }
      const legacy = await readOptionalJson(join(this.configDir(), BOT_CONFIG_LEGACY_FILE_NAME));
      const parsed = botsConfigSchema.parse(
        legacy === undefined ? createDefaultBotsConfig() : importLegacyBotConfig(legacy),
      );
      await writeJson(path, parsed);
      return parsed;
    });
  }

  async writeConfig(config: BotsConfig): Promise<BotsConfig> {
    const parsed = botsConfigSchema.parse(config);
    const path = join(this.configDir(), BOT_CONFIG_V3_FILE_NAME);
    await withFileLock(path, () => writeJson(path, parsed));
    return parsed;
  }

  async readState(): Promise<BotsState> {
    const path = join(this.configDir(), BOT_STATE_V3_FILE_NAME);
    return withFileLock(path, async () => {
      const current = await readOptionalJson(path);
      if (current !== undefined) {
        return botsStateSchema.parse(current);
      }
      const v2 = await readOptionalJson(join(this.configDir(), BOT_STATE_V2_FILE_NAME));
      const legacy =
        v2 === undefined
          ? await readOptionalJson(join(this.configDir(), BOT_STATE_LEGACY_FILE_NAME))
          : v2;
      // 发布包 host 没有 createDefaultBotsState。没有旧文件时直接写空状态。
      const parsed = botsStateSchema.parse(
        legacy === undefined ? { version: 3, bots: {} } : importLegacyBotState(legacy),
      );
      await writeJson(path, parsed);
      return parsed;
    });
  }

  async writeState(state: BotsState): Promise<BotsState> {
    const parsed = botsStateSchema.parse(state);
    const path = join(this.configDir(), BOT_STATE_V3_FILE_NAME);
    await withFileLock(path, () => writeJson(path, parsed));
    return parsed;
  }
}

import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isCuaLocalDevelopmentRuntime, resolveZcodeHome } from "./helper-install-plan.js";

const DEV_EXPOSE_ENV = "ZCODE_CUA_DEV_EXPOSE_BROKER";
const CREDENTIALS_FILE = "broker-credentials.json";
// 发布包把这段目录提成顶层 join。main / scheduler 摇掉函数后仍留下这次调用。
const DEV_BROKER_RUN_DIR = join("computer-use", "run");

export function isDevBrokerExposureEnabled(env) {
  if (!isCuaLocalDevelopmentRuntime(env ?? {})) return false;
  const raw = env?.[DEV_EXPOSE_ENV];
  const flag = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return flag === "1" || flag === "true" || flag === "on";
}

function resolveDevBrokerCredentialsFilePath(env = process.env) {
  const home = resolveZcodeHome(env);
  return home ? join(home, DEV_BROKER_RUN_DIR, CREDENTIALS_FILE) : null;
}

export async function writeDevBrokerCredentialsFile(options) {
  if (!isDevBrokerExposureEnabled(options.env)) return;
  const target = resolveDevBrokerCredentialsFilePath(options.env ?? process.env);
  if (!target) {
    options.logger?.warn(
      undefined,
      "ZCODE_CUA_DEV_EXPOSE_BROKER=1 but ZCODE_HOME/HOME is not resolvable; skipping broker credential exposure (no path to write to).",
    );
    return;
  }
  const directory = join(target, "..");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const body = `${JSON.stringify({ socket: options.socketPath })}\n`;
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  options.logger?.warn(
    undefined,
    `ZCODE_CUA_DEV_EXPOSE_BROKER=1: wrote broker socket path to ${target} for the external test harness. NEVER enable this in production.`,
  );
}

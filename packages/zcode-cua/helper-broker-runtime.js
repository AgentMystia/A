import { randomBytes } from "node:crypto";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const STALE_BROKER_SOCKET_MS = 1440 * 60 * 1000;
const BROKER_SOCKET_NAME = /^broker-[0-9a-f]{16}\.sock$/u;

export const WINDOWS_HELPER_PIPE_PREFIX = "\\\\.\\pipe\\zcode-cua-helper-";
export const STABLE_BROKER_SOCKET_NAME = "broker.sock";

export function isWindowsNamedPipePath(socketPath) {
  return socketPath.startsWith("\\\\.\\pipe\\");
}

export function brokerRuntimeDir(env) {
  const runtimeDir = env.XDG_RUNTIME_DIR;
  if (typeof runtimeDir === "string" && runtimeDir.trim().length > 0) {
    return join(runtimeDir, "zcode-cua");
  }
  if (process.platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    return typeof localAppData === "string" && localAppData.trim().length > 0
      ? join(localAppData, "zcode", "cua-broker")
      : join(homedir(), "AppData", "Local", "zcode", "cua-broker");
  }
  if (process.platform === "darwin") {
    const uid = typeof process.getuid === "function" ? process.getuid() : "nouid";
    return join("/tmp", `zcode-cua-${uid}`);
  }
  return join(homedir(), ".zcode", "cua-broker");
}

// 发布包在铸造随机 socket 前清掉超过一天的 broker-*.sock，避免运行时目录被旧预留占满。
export function pruneStaleBrokerSockets(directory) {
  try {
    const staleBefore = Date.now() - STALE_BROKER_SOCKET_MS;
    for (const name of readdirSync(directory)) {
      if (!BROKER_SOCKET_NAME.test(name)) continue;
      const socketPath = join(directory, name);
      try {
        if (statSync(socketPath).mtimeMs >= staleBefore) continue;
        unlinkSync(socketPath);
      } catch {
        // 单个旧 socket 删不掉不阻止本次铸造。
      }
    }
  } catch {
    // 目录还不存在时直接铸造。
  }
}

export function randomBrokerSocketSuffix() {
  return randomBytes(8).toString("hex");
}

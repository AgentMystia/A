import { createHash } from "node:crypto";
import { buildRemoteEnvironmentKey, type RemoteTarget } from "@zcode/shared";

/**
 * 同规格远端环境不能合并；只传规范环境身份的哈希，原始地址不进入遥测旁路。
 * server 连接拿到 serverInfo.serverId 后用它覆盖 target，避免握手前的本地 id 和远端声明分裂。
 */
export function resolveResourceTelemetryEnvironmentKey(
  target: RemoteTarget,
  serverId?: string,
): string {
  const identity = target.kind === "server" && serverId ? { ...target, serverId } : target;
  return createHash("sha256").update(buildRemoteEnvironmentKey(identity)).digest("hex");
}

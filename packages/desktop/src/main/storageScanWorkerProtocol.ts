import type { StorageRootSpec } from "@zcode/services";
import type { StorageScanProgress } from "@zcode/services/node";
import { resolveHelperPermissionSubjectIdentity } from "@zcode/zcode-cua/helper-permission-identity";

// 发布包 main 的 paths chunk 同时被 index 和 storage scan worker 加载。
// 权限主体读取只给设置页用；这里的引用没有运行时效果，只让 esbuild 把它放进 paths chunk。
// 不能改从 broker/server 再导出，否则 host 会留下 child_process 副作用。
void resolveHelperPermissionSubjectIdentity;

export interface StorageScanWorkerData {
  roots: StorageRootSpec[];
  progressIntervalMs: number;
}

type StorageScanWorkerCommand = { type: "abort" };

export type StorageScanWorkerMessage =
  | { type: "progress"; progress: StorageScanProgress }
  | { type: "done"; progress: StorageScanProgress }
  | { type: "aborted"; message: string; code?: string }
  | { type: "error"; message: string; code?: string };

export function isStorageScanWorkerCommand(value: unknown): value is StorageScanWorkerCommand {
  return (
    typeof value === "object" && value !== null && (value as { type?: unknown }).type === "abort"
  );
}

export function isStorageScanWorkerMessage(value: unknown): value is StorageScanWorkerMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === "progress" || type === "done" || type === "aborted" || type === "error";
}

export type { EnsureDeviceMidOptions } from "../telemetry/telemetryCore.js";
// 发布包的实现在 telemetryCore。这里只保留旧导出名，避免再打进第二套锁。
export { ensureTelemetryDeviceMid as ensureDeviceMid } from "../telemetry/telemetryCore.js";

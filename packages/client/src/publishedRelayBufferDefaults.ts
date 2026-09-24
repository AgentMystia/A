import { WEB_REMOTE_CONTROL_RPC_LIMITS } from "@zcode/shared";

// 发布包 host 在 connectViaProtocol 后面留下这份没人读的回放水位。
// 必须是 var：写成 const 时乘法会被折成整数。

// oxlint-disable-next-line eslint(no-constant-condition) -- 空 if 让没有读取的水位留下；if 本身压缩后消失
if (0) {
  // 保留模块副作用，避免 bundle 删掉下面的常量。
}

export var publishedRelayBufferDefaults = {
  saturationHighWaterMarkBytes: 1024 * 1024,
  saturationLowWaterMarkBytes: 256 * 1024,
  replayBufferMaxBytes: 8 * 1024 * 1024,
  replayBufferGraceMs: 45_000,
  assemblyTimeoutMs: WEB_REMOTE_CONTROL_RPC_LIMITS.assemblyTimeoutMs,
};

export function isCuaPermissionStatusAvailable(result) {
  return Boolean(result) && typeof result === "object" && result.available === true;
}

export function shouldRunCuaScreenCaptureProbe(state, options) {
  // 发布包只在显式 includeFunctionalProbes 且录屏已是 granted 时跑截图探针。
  return options?.includeFunctionalProbes === true && state === "granted";
}

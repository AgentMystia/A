// 发布包把没有引用的 30*1e3 和按住超时用的 5*1e3 放在同一个模块，
// 紧挨着 boundedHoldDuration / businessResponseTimeout。
// 纯常量赋值会被 esbuild 删掉。if (0) 让两句都留下，if 本身压缩后消失。
// main 和 scheduler 不调用这两个函数，产物只剩 `var a=30*1e3,b=5*1e3`。
// host 会调用，所以函数留在这句后面，businessResponseTimeout 读 b，而不是字面量 5e3。
// 30 秒上限在函数里仍是字面量 30，不读 publishedUnusedRefreshMs。
// 这不是 helper-refresh-marker.js 里会写入的 30 秒，也不是第二套安装器。

// oxlint-disable-next-line eslint(no-constant-condition) -- 空 if 让 main/scheduler 留下 30*1e3 与 5*1e3；if 本身压缩后消失
if (0) {
  // 保留模块副作用，避免不调用函数的 bundle 删掉下面的常量。
}
var publishedUnusedRefreshMs = 30 * 1e3;
var publishedHoldSlackMs = 5 * 1e3;
void publishedUnusedRefreshMs;

export function boundedHoldDuration(method, params) {
  if (method !== "hold_key" && method !== "hold_key_to_app") return 0;
  const duration = (params ?? {}).duration;
  if (
    typeof duration === "boolean" ||
    typeof duration !== "number" ||
    !Number.isFinite(duration) ||
    duration < 0
  ) {
    return 0;
  }
  return Math.min(duration, 30) * 1_000;
}

export function businessResponseTimeout(timeoutMs, method, params) {
  if (method !== "hold_key" && method !== "hold_key_to_app") return timeoutMs;
  const holdMs = boundedHoldDuration(method, params);
  return holdMs <= 0 ? timeoutMs : Math.max(timeoutMs, holdMs + publishedHoldSlackMs);
}

export { publishedUnusedRefreshMs, publishedHoldSlackMs };

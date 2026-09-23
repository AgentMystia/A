// 发布包在恢复文案之后留了一对没有引用的超时。
// 纯数字 var 会被 esbuild 整段删掉。同模块里的 if (0) 让两句赋值活下来，
// if 本身压缩后消失，产物是 `var a=30*1e3,b=5*1e3`。
// 这不是 helper-refresh-marker.js 里会写入的 30 秒，也不是第二套安装器。

// oxlint-disable-next-line eslint(no-constant-condition) -- 空 if 让 esbuild 留下 30*1e3 与 5*1e3；if 本身压缩后消失
if (0) {
  // 保留模块副作用，避免压缩删掉下面的常量。
}
var publishedUnusedRefreshMs = 30 * 1e3;
var publishedUnusedRefreshGraceMs = 5 * 1e3;
void publishedUnusedRefreshMs;
void publishedUnusedRefreshGraceMs;

export { publishedUnusedRefreshMs, publishedUnusedRefreshGraceMs };

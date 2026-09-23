/**
 * 发布包在 session schema 之后留了一个没有引用的 1 小时常量。
 * 纯常量 var 会被 esbuild 整段删掉。同模块里的 if (0) 让赋值活下来，if 本身压缩后消失，
 * 产物是没有引用的 `var xx=3600*1e3`。void 只满足 lint。
 */
// oxlint-disable-next-line eslint(no-constant-condition) -- 空 if 让 esbuild 留下 3600*1e3；if 本身压缩后消失
if (0) {
  // 保留模块副作用，避免压缩删掉下面的常量。
}
var publishedUnusedHourMs = 3600 * 1e3;
void publishedUnusedHourMs;

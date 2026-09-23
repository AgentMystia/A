// 发布包把未引用的 128MiB 写成单独的 var，不跟方法表旁边的 16MiB 帧上限并成一句。
// 这不是 content bundle cache。纯常量赋值会被删掉。if (0) 让 var 留下，if 本身压缩后消失。

// oxlint-disable-next-line eslint(no-constant-condition) -- 空 if 让没有读取的 128*1024*1024 留下；if 本身压缩后消失
if (0) {
  // 保留模块副作用，避免 bundle 删掉下面的常量。
}
var publishedUnusedByteCeiling = 128 * 1024 * 1024;
void publishedUnusedByteCeiling;

export { publishedUnusedByteCeiling as PUBLISHED_UNUSED_BYTE_CEILING };

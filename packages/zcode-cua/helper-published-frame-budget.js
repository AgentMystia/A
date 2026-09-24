// 发布包在方法表 Set 之后单独留下帧上限和 8 秒预算。
// 必须是 var：写成 const 时，预留模块里的 8e3+2e3 会被折成 1e4。
// 这不是临时文件残留里的另一份 16MiB，也不是营销下载上限。

// oxlint-disable-next-line eslint(no-constant-condition) -- 空 if 让没有读取的帧上限留下；if 本身压缩后消失
if (0) {
  // 保留模块副作用，避免 bundle 删掉下面的常量。
}
var publishedFrameBytes = 16 * 1024 * 1024;
var publishedEightSecondBudgetMs = 8_000;

export { publishedEightSecondBudgetMs, publishedFrameBytes as BROKER_MAX_FRAME_BYTES };

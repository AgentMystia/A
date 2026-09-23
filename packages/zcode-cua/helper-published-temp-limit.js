// 发布包在第二份 mkdtemp import 后面留着没有读取的 16*1024*1024。
// 纯常量赋值会被删掉。if (0) 让它留下，if 本身压缩后消失。
// 这不是帧上限，也不是营销下载上限。

import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

void execFile;
void execFileSync;
void mkdtempSync;
void readFileSync;
void rmSync;
void tmpdir;
void join;

// oxlint-disable-next-line eslint(no-constant-condition) -- 空 if 让没有读取的 16*1024*1024 留下；if 本身压缩后消失
if (0) {
  // 保留模块副作用，避免 bundle 删掉下面的常量。
}
var publishedUnusedTempReadLimit = 16 * 1024 * 1024;
void publishedUnusedTempReadLimit;

export { publishedUnusedTempReadLimit };

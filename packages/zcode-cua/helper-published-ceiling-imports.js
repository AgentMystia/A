// 发布包在单独的 128MiB var 前面留着这组没有调用的 import。
// void 不执行命令，也不是第二套安装器。

import { execFileSync } from "node:child_process";
import { platform } from "node:os";

void execFileSync;
void platform;

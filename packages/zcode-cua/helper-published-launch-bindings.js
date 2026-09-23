// 发布包在 helper 启动模块前面单独留了这组 import。
// 预检读取和 open 用这里的 execFile / existsSync / readFileSync / rmSync。
// 没有调用的绑定只 void 一次，不读文件，也不是第二套安装器。

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { realpath, rm } from "node:fs/promises";
import { basename, join } from "node:path";

void randomUUID;
void writeFileSync;
void realpath;
void rm;
void basename;

export {
  basename,
  execFile,
  existsSync,
  join,
  randomUUID,
  readFileSync,
  realpath,
  rm,
  rmSync,
  writeFileSync,
};

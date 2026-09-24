// 发布包把 paths 真正用到的 node 绑定和一组没有调用的 fs 同步函数放在前一个模块。
// void 让 esbuild 保留 import，压缩后 void 消失。这些绑定不读文件。
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join, win32 } from "node:path";
import { homedir } from "node:os";

void copyFileSync;
void existsSync;
void mkdirSync;
void readFileSync;
void unlinkSync;
void writeFileSync;

export { lstatSync, cp, createHash, basename, join, win32, homedir };

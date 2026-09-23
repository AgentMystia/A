// 发布包在键页常量后面留着这组没有调用的 import。void 只为保留 import，不创建临时目录。

import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

void execFile;
void execFileSync;
void mkdtempSync;
void readFileSync;
void rmSync;
void tmpdir;
void basename;
void join;

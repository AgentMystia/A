// 发布包在 ax_native 路径后面留着这组没有调用的 import。void 不读文件。

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

void randomUUID;
void execFileSync;
void lstat;
void mkdir;
void open;
void readFile;
void rm;
void writeFile;
void join;
void process;

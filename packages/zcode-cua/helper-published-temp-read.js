// 发布包在两份 mkdtemp import 中间留着这组没有调用的 import。void 不读目录。

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

void execFile;
void readdir;
void readFile;
void homedir;
void basename;
void join;

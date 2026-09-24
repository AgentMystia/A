// 发布包另有一份没有调用的 spawnSync / realpathSync / path import。
// 不创建进程，也不是 helper-process-evidence.js 里的 ps。

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

void spawnSync;
void realpathSync;
void basename;
void dirname;
void isAbsolute;
void relative;
void resolve;
void sep;

// 发布包把 ax_native 路径放在角色映射后面的单独模块。
// createRequire / existsSync / dirname / isAbsolute / fileURLToPath 没有调用。
// void 只保留 import。真正用到的只有 join。

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

void createRequire;
void existsSync;
void dirname;
void isAbsolute;
void fileURLToPath;

export const PUBLISHED_AX_NATIVE_BINDING = join("build", "Release", "ax_native.node");

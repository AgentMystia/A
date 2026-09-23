// 发布包在上一组空 import 后面再留一份没有调用的 execFileSync / realpathSync / join。

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";

void execFileSync;
void realpathSync;
void join;

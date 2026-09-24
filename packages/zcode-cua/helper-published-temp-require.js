// 发布包在 PiP schema 前面留着没有调用的 createRequire 和 join。

import { createRequire } from "node:module";
import { join } from "node:path";

void createRequire;
void join;

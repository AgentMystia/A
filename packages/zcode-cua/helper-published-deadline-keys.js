// 发布包把刷新标记的字段名冻成一个没有读取的 Set，并在同一模块留下
// 一组没有调用的 fs 同步 import。void 让绑定算被读过，压缩后 void 消失，import 还在。
// 真正写入 deadlineEpochMs 的标记在 helper-refresh-marker.js，这里不是第二份写入。

import { closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync } from "node:fs";

void closeSync;
void fstatSync;
void lstatSync;
void openSync;
void readFileSync;
void readSync;

var publishedUnusedDeadlineKeys = Object.freeze(new Set(["schema", "kind", "deadlineEpochMs"]));
void publishedUnusedDeadlineKeys;

export { publishedUnusedDeadlineKeys };

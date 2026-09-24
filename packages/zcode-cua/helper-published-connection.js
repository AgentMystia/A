// 发布包在空 peer 检查和 AsyncLocalStorage 之间单独留了一次 createConnection import。
// 绑定没有调用方。void 只为了让 esbuild 保留 import，压缩后 void 会消失。

import { createConnection } from "node:net";

void createConnection;

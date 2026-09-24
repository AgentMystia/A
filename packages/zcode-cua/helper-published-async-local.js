// 发布包在同一条 catalog 链上构造了一次没有读取的 AsyncLocalStorage。
// new 是副作用。tsup 会去掉 node: 前缀，压缩后仍是 from "async_hooks"。

import { AsyncLocalStorage } from "node:async_hooks";

var publishedUnusedAsyncLocalStorage = new AsyncLocalStorage();
void publishedUnusedAsyncLocalStorage;

export { publishedUnusedAsyncLocalStorage };

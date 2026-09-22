# 从发布包恢复的桌面协议

发布包构建提交 `cead36fd` 的 main bundle 把频道表打成了对象字面量。当前仓库的 `channels.ts` 少了这些键，字符串值与发布包一致，没有改写。

## 所有者

- 频道字符串只在 `packages/shared/src/channels.ts` 定义。
- Web 远程控制的状态投影类型在 `packages/shared/src/webRemoteControl.ts`。Desktop main 的 manager 仍未恢复，所以这些类型现在没有运行时写入者。
- Bot 远端 workspace 的 host 消息由 `packages/shared/src/validation.ts` 的 schema 校验。Main 进程收到后目前没有对应 handler，消息会被忽略，和校验失败一样不会改 session。

## 行为

- Service channel 增加 `cloud-content`、`marketing-touch`、`output-style`、`bots`。
- Platform channel 增加 Bot 重连通知，以及 Web 远程控制的开启、刷新配对、停止、状态、workspace/task 同步和重连。
- Host 消息增加三条 Bot 请求（host → main）和三条结果（main → host）。`runtime-port` 的 MessagePort 走 transfer list，不进 JSON。
- Web 远程控制状态字是 `idle`、`running`、`active`、`cancelled`。`buildRuntimeStatus` 只发出前三个；renderer 会把 start/refresh 的 `cancelled` 收成 `idle`。

## 验收

- `pnpm typecheck` 通过。
- 新增键的字符串与发布包 `main/chunk-YSD25WTT.js` 里的频道对象一致。
- 本规格不表示生产包 SHA-256 已经与 `66fabd76d12be24cc3b83060be66e09cad10745edd9f2d17e6d67eeea3de3832` 一致。manager、Bot 服务和 renderer 组件仍在压缩包里，没有源码。

# 从发布包恢复的桌面协议

发布包构建提交 `cead36fd` 的 main bundle 把频道表打成了对象字面量。频道字符串与发布包一致。

## 所有者

- 频道字符串只在 `packages/shared/src/channels.ts` 定义。
- Web 远程控制的对外状态、workspace/task 快照和失败原因在 `packages/shared/src/webRemoteControl.ts`。
- RPC 物理帧的编码、校验和重组在 `webRemoteControlRpc.ts` 一族。它们不持有连接。
- 应用层 payload 的 zod 约束在 `webRemoteControlPayload.ts`。非法 payload 在进 manager 之前丢掉。
- 二维码、v4 版本门槛和 relay WebSocket 地址在 `webRemoteControlEndpoint.ts`。`buildZCodeEndpointUrls` 同时给出 `remoteUrl` / `webRemoteCallbackUrl` / `relayWsUrl`；manager 实际拨号仍走 `resolveWebRemoteControlRelayWsUrl`，生产默认是 `wss://zcode.z.ai/ws`，测试域 `https://zcode.chatglm.site` 用 `wss://zcode.chatglm.site/ws`，`ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL` 优先。
- 可变会话只属于 Desktop main 的 `createWebRemoteControlManager`。每条 workspace bridge 自己的 acknowledged relay 持有那条桥的重放缓冲；拆桥或降级时清掉，不另做进程级队列。Settings 只存 `webRemoteControlExternalRelayDevice.deviceSid` 和 `webRemoteControlLastEnabledContext`。`pass_hash` 只进凭据服务，键为 `web-remote-control:external-relay:pass_hash`。Renderer 只提交草稿和同步快照，不保存已接受的 relay 会话。
- 手机链路的 host attachment 使用 `clientMode: "web-remote-replayable"`。桌面窗口自己的 host 端口仍是 `desktop-continuous`。两条链路共用窗口 Host，不另起进程。
- Bot 远端 workspace 的 host 消息由 `validation.ts` 校验。Main 收到后仍然没有业务 handler，消息会被忽略。

## 行为

- Service channel：`cloud-content`、`marketing-touch`、`output-style`、`bots`。
- Platform channel：Bot 重连通知，以及 Web 远程控制的开启、刷新配对、停止、状态、workspace/task 同步和重连。
- 状态字：`idle`、`starting`、`running`、`connecting`、`active`、`error`、`cancelled`。Manager 在传输尚未出码时写 `starting`，等手机时写 `running`，建 bridge 时写 `connecting`，手机已配对或 bridge 活跃时写 `active`，传输失败写 `error`。`cancelled` 留给 renderer 把 start/refresh 的取消结果收成 idle。
- 开启授权 30 秒、一次性、绑定窗口和 workspace key。QR 就绪超时 30 秒。手机断开有 3 秒宽限。出站应用 payload 最多缓冲 50 条，5 秒送不出去就丢弃。
- 配对成功前不把应用 payload 送进 relay。超限帧记为 oversize，不进入缓冲。
- 远程 workspace 只有同时具备 `workspaceIdentity` 和 `remoteSessionId` 才能建 bridge。本地 workspace 不要求这两项。
- 窗口关闭、手动停止、刷新配对都会停掉该窗口的 runtime，并关闭它名下的 replayable host attachment。远程 session 连接关闭时，manager 拆掉对应 bridge，并通知手机 `workspace-closed`。

## 验收

- `pnpm typecheck` 与 `pnpm lint` 通过。
- 频道字符串与发布包 `main/chunk-YSD25WTT.js` 一致。
- RPC 小消息可以编码后再按序重组回原字节。
- 本规格不表示生产包 SHA-256 已经与 `66fabd76d12be24cc3b83060be66e09cad10745edd9f2d17e6d67eeea3de3832` 一致。Bot 服务、marketing 和 renderer 组件仍未还原成可编译源码。

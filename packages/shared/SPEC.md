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
- 本规格不表示生产包 SHA-256 已经与 `66fabd76d12be24cc3b83060be66e09cad10745edd9f2d17e6d67eeea3de3832` 一致。Renderer 组件仍未从混淆产物唯一还原。

## 从 Host keepNames 恢复的服务

发布包 host `index.js` / `chunk-GVBBGMXG.js` 用 `keepNames` 保留了工厂名。这些服务的状态所有者和协议如下。

### 所有者

- `marketing-touch`：Host 内唯一请求面。身份 scope 是 token 变化时换发的 UUID；device mid 必须是 UUID。快照只交给 `createMarketingAssetRegistry`，不另存一份 delivery 队列。
- `cloud-content`：Host 内唯一 zip bundle 租约面。下载、解包、本地 loopback HTTP 只服务已放行的 sha256。`disposeAllAndWait` 后不再接受 prepare。
- `output-style`：用户 `~/.claude/output-styles` 与 `~/.claude/settings.json` 的读写面。内置 default/explanatory/learning 不落盘。
- `bots`：`bot-config.v3.json` / `bot-state.v3.json` 在 `getAppConfigDir()`。Repo 是唯一持久化入口。运行时 status、inbound queue、provider polling 只活在 `createBotsService` 实例里。
- 手动领取：不是独立 service。方法挂在 Coding Plan 的 BigModel provider 上，走 `/api/v1/zcode-plan/billing/preview` 与 `/claim`。
- Memory：同一 `memory` 频道。Project Memory catalog 之外还读写 `~/.claude/memory/MEMORY.md`。

```text
renderer hook → ProxyChannel → Host 单例
                    └── 持久化 / bundle cache / ~/.claude 只由该单例写入
```

### 行为

- marketing GET `/api/v1/marketing/touch?seq=`，POST `/api/v1/marketing/touch/action`。token 在 query/report 之间变化则抛 `marketing_identity_changed`。
- 资源只允许 https（测试可放行 loopback）。image 8MiB、video 16MiB，按 sha256 校验。
- cloud-content zip 入口必须是 `.html`，单文件 8MiB，解包合计 32MiB，磁盘 cache 128MiB。loopback 只监听 `127.0.0.1`。
- bots provider：telegram / webhook / feishu / lark / weixin 可用；discord / wecom 仅占位。
- 远端 workspace 的 bots 不跑 startup polling（`runStartupBackgroundTasks: false`），也不注册 marketing / cloud-content。
- 飞书 App ID 必须匹配 `/^cli_[0-9a-fA-F]{16}$/`。飞书注册走 `accounts.feishu.cn` / `accounts.larksuite.com` 的 `/oauth/v1/app/registration`，`source=node-sdk/zcode`。
- 微信 iLink API 基址 `https://ilinkai.weixin.qq.com/ilink/bot`，注册 QR 走同一 host。
- Telegram 命令名 workspace=`project`、thoughtLevel=`think`。绑定码 3 字节 hex 大写，默认 TTL 30s。
- 飞书回复粒度只保留 `streaming_card`；其余 provider 去掉该粒度。
- `listUserConfigOptions` 发布包 keepNames 实现返回 `[]`。
- 手动领取 `server_time` 秒值乘 1000；JWT 键 `zcodejwttoken`；平台头 `${platform}-${arch}`。
- 已从 keepNames 唯一还原的 inbound：`bind`、`help`、`status`、`reconnect`、`mode.list`/`mode.set`（回复 `modeLocked`）、`reply.list`/`reply.set`（`reply.set` 走公开 `saveBot`）、unknown、微信首次激活、`new`、`workspace`、`model`、`thoughtLevel`、`task`、`stop`、`permission`、`elicitation`、`message`、`selection.cancel`。
- `createBotsService` 唯一注入 `zcodeTaskService` 与 `modelSelectionService`。`resolveZCodeTaskServiceForContext` / `resolveModelSelectionServiceForContext`：无 `workspaceIdentity` 用本机服务，否则问 `remoteWorkspaceService`，缺失则抛中文重连错误。
- 草稿默认 `provider=glm`、`mode=yolo`。`/mode` 仍只回复 `modeLocked`。`listUserConfigOptions` 仍返回 `[]`。
- `watchAutomationRun` 不写 bot-state；唯一投递是 `watchTaskStream(..., replyMode: "summary_changes")`。
- callback 只覆盖 webhook/feishu secret、displayName、inbound 去重、acknowledge 与 outbound。

```text
createLocalServices
  ├── marketing-touch + cloud-content   （仅本机 Host）
  ├── bots(runStartupBackgroundTasks)
  │     └── BotRemoteWorkspaceService   （仅本机 Host，经 parentPort 问 Main）
  └── output-style + memory extras

createRemoteWorkspaceServiceCollection
  ├── bots(runStartupBackgroundTasks:false)
  └── output-style + memory extras
        （不注册 marketing / cloud-content，不建 C2）
```

### 验收

- `pnpm typecheck` 与 `pnpm lint` 通过。
- 服务频道字符串仍与发布包一致。
- marketing / output-style / cloud-content / bots repo / 手动领取的 schema 与发布包 zod 字面量一致。
- 本规格仍不表示生产包 SHA-256 已匹配；renderer 仍未从混淆产物唯一还原。

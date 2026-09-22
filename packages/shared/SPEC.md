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
- Bot 远端 workspace 的 host 消息由 `validation.ts` 校验。Main 的 `spawnHostProcess` 是唯一回写面：重连、连接状态、runtime port。会话是否仍 attachable 只读 `createRemoteWorkspaceSessionManager` 的 route 表。重连 in-flight 是另一张 map，键为 `webContentsId + workspaceIdentity`，不与 `requestId` pending 表混用。

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
- Desktop `vite.config.ts`、`tsup.config.ts` 与 Web `vite.config.ts` 在配置加载期用相对路径内联 `packages/shared/src/zcodeEndpoint.ts`。端点规则仍只属于该模块。裸包名 `@zcode/shared/zcodeEndpoint` 会被配置打包器外置，Node 再加载源码时无法把 `.js` 说明符解析到 `.ts`。
- Desktop tsup 把 `sharp` 与 `@larksuiteoapi/node-sdk` 标为 external。发布包产物里这两处仍是动态 `import`，不内联进 main/host。
- 奖励页 URL、分区 `persist:zcode-rewards` 和上下文注入脚本只在 `rewardsWebview.ts`。可信地址是 `https://zcode.z.ai` 或 `https://zcode.chatglm.site` 的 `/(cn|en)/rewards`，且 `embedded=app`；带用户名或密码的 URL 不可信。未打包进程允许 `http://localhost:3000`，E2E 允许 loopback。测试环境默认 origin 是 `https://zcode.chatglm.site`，否则 `https://zcode.z.ai`。`VITE_REWARDS_WEBVIEW_ORIGIN` 只有在按该规则拼出的地址仍可信时才采用其 origin。Desktop 奖励 guest 使用 `preload/rewardsWebview.cjs`，未打包时追加 `--zcode-rewards-dev`。离开可信奖励页时阻止导航，http(s) 交给系统浏览器。页面桥 `window.zcodeBridge` 只在可信页挂上，并先清掉 `oauth:zai:access_token`、`oauth:bigmodel:access_token`、`zcodejwttoken`。

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
- `listUserConfigOptions` 发布包 keepNames 实现返回 `[]`。`listProviderConfigOptionsForActiveTask` 只调用它。`readCurrentActiveTaskMode` 取 config `mode` 的 currentValue，否则用 task.mode。
- 任务列表广播频道是 `bots:task`（`broadcastTaskListChange` / `broadcastTaskConfigSync`）。每条任务流事件先走 `bots:task-stream`（`broadcastTaskStreamEvent`），`task_stream_mirror_batch` 只广播批次本身，内嵌 `stream_event` 不再次广播。不得使用 `bots:task-list`。
- 手动领取 `server_time` 秒值乘 1000；JWT 键 `zcodejwttoken`；平台头 `${platform}-${arch}`。
- 已从 keepNames 唯一还原的 inbound：`bind`、`help`、`status`、`reconnect`、`mode.list`/`mode.set`（回复 `modeLocked`）、`reply.list`/`reply.set`（`reply.set` 走公开 `saveBot`）、unknown、微信首次激活、`new`、`workspace`、`model`、`thoughtLevel`、`task`、`stop`、`permission`、`elicitation`、`message`、`selection.cancel`。
- `createBotsService` 唯一注入 `zcodeTaskService` 与 `modelSelectionService`。`resolveZCodeTaskServiceForContext` / `resolveModelSelectionServiceForContext`：无 `workspaceIdentity` 用本机服务，否则问 `remoteWorkspaceService`，缺失则抛中文重连错误。
- 草稿默认 `provider=glm`、`mode=yolo`。`/mode` 仍只回复 `modeLocked`。`listUserConfigOptions` 仍返回 `[]`。
- `watchAutomationRun` 不写 bot-state；唯一投递是 `watchTaskStream(..., replyMode: "summary_changes")`。
- callback 只覆盖 webhook/feishu secret、displayName、inbound 去重、acknowledge 与 outbound。
- 已从 keepNames 唯一还原的附件链路：`sanitizeAttachmentFilename`、`formatAttachmentSize`、`formatAttachmentRejectedReason`、`buildAttachmentCachePath`、`fetchAttachmentDownloadUrl`、`resolveAttachmentBytes`、`cacheResolvedAttachment`、`prepareBotMessageContent`。最多 4 个附件、5MB、下载超时 30s；image/audio 进 `zcodeAttachments`，失败回 `attachmentRejected`。
- 已从 keepNames 唯一还原：`isSessionExpiredError`、`formatUserFacingBotError`、`reconnectRemoteWorkspaceForBot`、`readTaskMeta`、`isTerminalTaskMeta`、`readTerminalTaskMeta`（轮询延迟 `[80,160,320]`）。
- 已从 keepNames 唯一还原的 elicitation：`normalizeBotElicitationQuestions`、`readBotElicitationRenderContext`、`formatBotElicitationTitle`、`createBotElicitationSelection`、`createBotElicitationRequestSnapshot`、`broadcastPendingElicitationProgress`、`createCompletedElicitationOutbound`、`handleElicitationRequest`。`watchTaskStream` 对 `elicitation_request` 调 `handleElicitationRequest`。
- `writeContext` 是 bot-state 的唯一写入。`isRemoteWorkspaceConnected`：无 identity 为已连接，无 remote service 为未连接，否则 `isConnected` 失败当未连接。`clearCandidateCaches` 只清 workspace ref 缓存，由 `refreshRuntimes` 调用。`saveBot` / `removeBotSecret` / `deleteBot` 已走 `refreshRuntimes`。
- inbound 去重只有一张 map：`markInboundDelivery` / `releaseInboundDelivery` / `pruneRecentInboundDeliveryDedupe`。`performRemoteReconnect` 是 `/重连` 已通过去重与冷却后的连接与草稿回写。`clearPendingElicitationForRequest` 在 requestId 匹配时清 elicitation selection 并持久化去掉 pending。
- `stopInboundTyping`：同一 bot 与同一 `providerMessageId` 仍有 live typing 时不调用 `stopTyping`。callback 在失败通知和成功投递之后调用它。callback acknowledge 超时是发布包变量 `yH = 3000`。
- 临时交互卡片只有一张 actor-key map：`upsertTransientInteractionCard` / `finalizeTransientInteractionCard`。`handleElicitationRequest` 在 `streaming_card` 时 upsert，不在 create 之后立刻再 update。
- `updateLiveStatusProgress` 只写 `createBotsService` 持有的一张 `liveStatusProgress` map。`agent_message_chunk` / `agent_thought_chunk` 按 kind 拼接并保留尾部 1000 字；`tool_call` / `tool_call_update` 覆盖为工具进度。终态删除该 task，`disposeAllAndWait` 清空整张 map。`buildStatusText` 在 active task 缺失 meta 或 `running` 时读取这张 map，否则回退 `readLatestTaskProgress`；耗时来自 snapshot，不另建缓存。
- `createAssistantReplyBlocks` 调用已有 `buildZCodeAssistantPresentation`。`summary_changes` 只取最新正文；`assistant_toolcalls_changes` 再附上 map 里的工具调用；有文件的 `changeSummary` 始终追加。`watchTaskStream` 的 parts、assistant buffer、tool map 与已回复 tool id 只活在该次订阅闭包，不写入 bot-state。
- 非 `summary_changes` 且非 `streaming_card` 时，`extractBotAssistantResponseMessages(force=false)` 不发出 partial；工具事件与终态用 `force=true`。终态若没有已发送内容也没有格式化块，发送 “Task completed.” / “任务已完成。”。
- 飞书 `streaming_card` 同步的时限是发布包常量：最小间隔 `kle=1000`、请求超时 `Ple=15000`、重试基数 `Cle=1000`、熔断次数 `ble=3`。卡片块只属于该次订阅。进行中的 AbortController 放进 service 的 abort set，`disposeAllAndWait` 以 `Bot service disposed.` 中止。不另造第二套卡片状态。工具摘要块是 `buildFeishuStreamingToolPanel`：灰色折叠面板，标题为 `🛠️ ${title} (${count})`。
- 进行中的 elicitation 回复带上发布包 `createElicitationReply` 的 `elicitation` 快照（`status: "pending"`、questions、answers、可选 expanded indexes 与 plan schema）。飞书卡片在该字段存在时走 `buildFeishuElicitationCardPayload`，否则回退普通交互卡片。已回答题目写成 markdown；当前题用选项按钮、自定义按钮和带 token 的 form（命令 `/elicitation <token> __form__:`）。卡片回调若命令含 `__form__:`，用 `form_value.answer` 重写成同一命令。应用名先读 appId，失败再读 `me`，并回退 i18n 名称。飞书用户显示名只由 `readFeishuUserDisplayName` 读取并缓存 10 分钟，键是 domain、appId、credentialRef 与 user id；`ou_` 用 `open_id`，`on_` 用 `union_id`，其余用 `user_id`。名字依次取 `name`、`en_name`、`nickname`。HTTP 或 `code !== 0` 抛错且不写缓存。文本消息在没有 `text` 时读 post 的标题与内容；附件 kind 按 image/audio/video/file 归一。
- `bot_delivery_target` 只在 automation create 时写入。公开 automation 对象不携带它。唯一读取是 `AutomationRepo.getBotDeliveryTarget`，非法 JSON 或 schema 不匹配返回 `undefined`。`dispatchCronRun` 在 `trackCronRunOutcome` 与 `sendPrompt` 之前调用 `watchCronRunBotDelivery`；订阅失败只打日志，不取消派发。机器人消息把 `resolveAutomationBotDeliveryTarget` 放进 `sendPrompt`，session/send 与 v4 `sendText` 都带可选 `botDeliveryTarget`。没有 `chatType` 的目标不发送，因为发布包 schema 要求 `private` 或 `group`。
- 机器人运行锁的删除按发布包重试 `EPERM` / `EBUSY` / `ENOTEMPTY`，间隔 100ms、250ms、500ms。rename 冲突还包括 `ENOTEMPTY`、`EISDIR`、`EPERM`。草稿 mode 只认 `category=mode` 的 select；别名能解析时 `resolveSupportedDraftMode` 仍返回调用方原始 modeId。
- `resumeSnapshotOrLegacy` 是 task adapter 唯一的 session 缺失恢复路径。先 `resumeSession`；只有 `Session not found` / `Session is not active` 才读 legacy snapshot。路径只取第一份已存在文件：`{taskId}.json`，否则 `{taskId}.deleted.json`。读失败或 schema 非法只打日志并返回 `null`，不改试下一份。`readLegacyTaskSnapshot` 合并 index meta 后把 task key 写入 adapter 内唯一的 legacy 集合；`migrationSource=claudeCode` 时尝试 `createSession(importedHistory)`，失败则继续只读。`resumeTask` 的 legacy 结果只 `syncTaskMeta` 并广播 `task_status_changed`。`getTaskSnapshot` 的 legacy 结果直接裁剪消息，index 已有 meta 时不再重写。该集合命中后 `onDynamicTaskEvent` 只订本地 emitter。两边都没有 mode 时按发布包写入 `"default"`；当前 mode 枚举不含该值，index 重读 `meta_json` 会告警并回退到 mode 列。
- `getBillingDiscount` 与 `getCaptchaConfig` 只读同一份 `client/configs` 快照。折扣在 `code` 有值且不为 0 时抛 `msg` 去空白后的文本，空文本用 `ZCode client config request failed`；`codingPlanBillingDiscount` 键不存在返回 `undefined`，键存在则原样返回。验证码不检查 `code`，缺失为 `null`。Renderer 活动文案只有一张模块级缓存，TTL 1 小时，失败不写入，同时只有一个 in-flight。当前 locale 的 `badgeBody` 非空才算活动生效。升级按钮、当前套餐标题、Start Plan 余额和会话额度条都读这一份缓存。
- Main 在 `app.whenReady` 给 `session.defaultSession.webRequest` 安装一份验证码网络诊断，所有者是这次安装闭包里的开始时间 map。过滤只覆盖 `https://*.alicdn.com/*` 与 `https://*.aliyuncs.com/*`。`onBeforeRequest` 一律 `callback({})`，不取消请求。`classifyCaptchaNetworkResource` 未命中则不记日志。命中后日志前缀是 `[captcha-network]`，只带 kind、host 和归一路径。map 超过 5 分钟的条目删除，达到 128 条时删最旧一条。完成或失败先删掉该请求的开始时间；没有分类不再记。`errorCode` 只保留 `/^net::ERR_[A-Z_]+$/`。这不是验证码控件。

```text
app.whenReady
  → installCaptchaNetworkDiagnostics(defaultSession.webRequest)
       onBeforeRequest：callback({}) → 分类失败则返回
       → 记录开始时间 → info resource.start
       onCompleted / onErrorOccurred：删除开始时间
       → 分类失败则返回
       → info resource.completed 或 resource.failed
```

- 未打包桌面进程的 DEV 角标只有一张图，所有者是 `devBadgeIcon` 模块。`app.whenReady` 在 Windows AUMID 之后、`applyAppIcon` 之前，仅当 `!app.isPackaged` 时调用 `renderDevBadgeIcon(iconPath)`。函数动态 `import("sharp")`，读图标文件，边长取宽高最小值，用 `buildDevRibbonSvg` 画蓝色 DEV 斜带，先 `blend:"over"` 再以原图 `blend:"dest-in"`。没有尺寸、结果为空或任意失败都打 `[dev-badge]` 警告并返回 `null`，继续用文件路径。打包态不调用，因为 `sharp` 不在 `app.asar`。Dock、主窗口和更新状态窗口读这一张图；退出确认、架构提示、Linux 桌面文件仍用路径。

```text
app.whenReady
  → win32 setAppUserModelId
  → 未打包：renderDevBadgeIcon → 唯一 NativeImage 或 null
  → applyAppIcon(image ?? iconPath)
createWindow / 更新状态窗口
  → resolveAppIcon：有图用图，否则用路径
```

- 桌面远端资源 CDN 只有 `resolveRemoteCdnBaseUrls` 一条选择路径。`overrideBaseUrl` 只去掉末尾斜杠，不追加版本，也不检查协议。之后按语言和时区算出顺序：`zh` 开头且时区偏移正好 480 分钟时国内 `https://cdn.codegeex.cn/zcode/electron/releases` 在前，否则海外 `https://cdn.zcode-ai.com/zcode/electron/releases` 在前。时区用 `en-CA`、`hourCycle: "h23"` 的 `formatToParts`，无效时区返回 `null`，`null` 不是 480。注入列表非空时忽略该顺序，只在每个根后面加 `/版本`。发布包注入的列表是 `https://cdn-zcode.z.ai/zcode/electron/releases`。运行时 `ZCODE_CDN_BASE_URL` 或构建期同名配置若是主机名，先补上 `/zcode/electron/releases`。发布包 test 环境返回的内网资源根不写入源码；test 与其它环境走同一条注入列表，列表为空才用语言和时区顺序。

```text
resolveRemoteCdnBaseUrls
  → override：去尾斜杠，原样返回
  → 计算国内/海外顺序
  → ZCODE_CDN_BASE_URL 或构建注入列表非空：列表 + /版本
  → 否则：语言和时区顺序 + /版本
```

- `interaction/requestProviderRuntimeHeaders` 的 pending 只属于 `createZCodeAgentService`。有账号服务且 `accountAccess.mode` 不是 `start-plan` 时自动应答。Start Plan、缺 access 或缺服务时保留 pending，发出 `providerRuntimeHeaders.request`，并只通知已经存在的 workspace emitter。`onDynamicWorkspaceProviderRuntimeHeadersRequest` 创建该 emitter 并重放本 workspace 的 pending；session 订阅同样重放。`respondProviderRuntimeHeaders` 只合并 `X-Aliyun-Captcha-Verify-Param` 与 `X-Aliyun-Captcha-Verify-Region`。取消删除 pending，日志是 `验证码请求已取消`，只在 cancelled emitter 已存在时通知。Task adapter 忽略该事件。

```text
CLI interaction/requestProviderRuntimeHeaders
  → pendingProviderRuntimeHeaders（唯一）
  → mode !== start-plan 且有账号服务：resolveAccountRequestAuth → client.respond
  → 否则 session event + 已存在的 workspace emitter
Renderer subscribe
  → 创建 emitter，重放 key 前缀匹配的 pending
Renderer respondProviderRuntimeHeaders
  → 合并两枚验证码头 → client.respond
cancel / invalidateWorkspaceClient
  → delete pending；cancelled emitter 已存在才 fire
```

- Coding Plan 远端错误先把 HTML/WAF 收成 `coding_plan_system_busy`。原文包含 `请完成安全验证` 或匹配 `/security verification/i` 时返回 `coding_plan_security_verification_required`，不再把验证文案原样抛出。
- `parentToolUseIdFromToolPayload` 先读 `parentToolUseId`、再读 `parentToolCallId`。两者都没有时读 `_meta.claudeCode.parentToolUseId`。空字符串不当作 id。
- server 远程身份只有 `buildRemoteWorkspaceIdentity` / `parseRemoteWorkspaceIdentity` 这一份。`resolveServerIdentityId` 依次取去掉空白后的 `serverId`、`name`、URL host，最后才是原始 url。`normalizeServerIdForIdentity` 把非 `a-z0-9._-` 收成 `-`，结果为空时抛 `serverId must contain at least one identity-safe character`。身份是 `remote:server:${slug}:${/path}`，path 经同一份归一。环境键是 `server:${serverId.trim() || normalizeServerEndpoint(url)}`，不带 workspace path，也不做 slug。遥测键只使用归一后的 url。token 不进 snapshot 和 open-in-editor；凭据键是 `remote-workspace:${workspaceKey}:server-token`。连接向导的可选 kind 由 `listRemoteConnectionWizardKinds` 决定：始终有 ssh，`isLocalDevelopmentRuntime===true` 时接着放 server，Windows 再放 wsl，最后是 docker。server 表单只有 url、name、token、workspacePath；不填 serverId。url 去掉空白后为空则 `server.validation.urlRequired`，`new URL` 抛错则 `server.validation.invalidUrl`。name、token、workspacePath 仅在 trim 后非空时写入 target。打包后的桌面端不展示 server 入口，但表单分支仍编进 renderer。server 的 logical session 与 docker 一样是 `server:dedicated:${remoteSessionId}`，不按 target 复用。进程 backend 不接受 server。
- server 远程连接只有 `connectServerRemote` 这一份。顺序是解析端点、GET `/api/server-info`（Bearer 和 query token）、POST `/api/rpc-host-capability`（只有 query token）、再连 `/ws/host`（Bearer、query token、`x-zcode-rpc-host-capability`）。服务来自 `connectViaProtocol(new SocketProtocol(wrap))`。这条集合直接注册远端服务；会话分享是不可用实现，拒绝原因 `server_remote_unsupported`。本机 `clientConfigService` 仍由窗口 Host 注入。资源遥测仅在 `serverInfo.capabilities.processResourceTelemetry===true` 时订阅。环境哈希在 server 且 `serverInfo.serverId` 非空时覆盖 target 上的 serverId。server 连接只 `socket.close()`，没有 `disposeAndWait`。ssh、wsl、docker 仍走原来的进程 backend 集合。

```text
createWindowRemoteConnectionHandle
  → kind=server: connectServerRemote
       info GET → capability POST → ws /ws/host open
       → SocketProtocol → connectViaProtocol
  → 其他: setupRemoteConnection
  → server: createServerRemoteWorkspaceServiceCollection
  → 其他: createRemoteWorkspaceServiceCollection
  → 遥测：非 server，或 processResourceTelemetry===true
abort / dispose
  → 有 disposeAndWait 则等待，否则 dispose()
```

- Bot 远端 workspace 查找只认 `attachmentState=attachable` 且同一 `webContents`。`isSameRemoteTarget`：ssh 比较小写 host、默认端口 22、trim 后的 username 和 `privateKeyPath ?? ""`；wsl 的空 distro 视为 `default`，user 只 trim；docker 比较 container 原文；server 只比较 `normalizeServerEndpoint(url)`，不比较 serverId、name、token。`hasRemoteWorkspaceSessionForTarget` 在传入 workspace 时用 `resolveWorkspaceKey`；空 key 不再按身份过滤。重连和 runtime 则要求 path 与 identity 字符串全等。已有 session 直接返回其 id。否则复用 in-flight promise，没有才 `createRemoteWorkspaceSession`。runtime 找不到 session 时抛 `未找到可供 Bot attachment 的远端 logical session`，找到后 `attachRemoteWorkspaceSessionHost`，`clientMode` 为 `web-remote-replayable`，`workspaceKey` 等于请求里的 `workspaceIdentity`，只把 `.port` 交回 Host。重连成功且窗口未销毁时，Main 向 renderer 发送 `zcode:bot-remote-workspace-reconnected`。未注入处理器时分别回 `未注入 Bot 远端 workspace 重连处理器。`、`未注入 Bot 远端 workspace 连接状态处理器。`、`未注入 Bot 远端 workspace runtime 处理器。`。

```text
Host bot-remote-workspace-*-request
  → spawnHostProcess
  → 无处理器：对应 result，ok=false，固定中文 error
  → reconnect：已有 route 或 in-flight，否则 createRemoteWorkspaceSession
       → 窗口仍在：BotRemoteWorkspaceReconnected
       → bot-remote-workspace-reconnect-result
  → status：hasRemoteWorkspaceSessionForTarget
       → bot-remote-workspace-connection-status-result
  → runtime：attach port 或抛缺少 logical session
       → bot-remote-workspace-runtime-port（成功时 transfer port）
```

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

### 发布包权限 broker 与 PiP 客户端

发布包 host 把两套互不替代的 socket 客户端打进了不同 chunk。Helper 安装、原生 addon 和 frame 谓词在本仓库仍是 fail-closed 占位，不从混淆产物另写一套安装器。

- 简单交换只属于 `packages/zcode-cua/broker.js` 的 `brokerExchange`。`callBrokerMethod` / `probeHelperHealth` 走它：先发 `id:0` 的空 `authenticate`，再发 `id:1` 的业务方法。鉴权被拒是 `CuaHelperError`，`code` 为 `auth_failed`。`probeHelperHealth` 在截止时间前按 `broker_info` 轮询，超时 `code` 为 `health_timeout`。
- `PermissionBrokerClient` 只属于 `permissionBrokerClient.js`。每条 RPC 新建连接，鉴权帧带 `clientApiVersion:2` 与 `authenticateParams`，业务 id 从 1 递增。默认 peer 检查拒绝 world-writable socket；Windows 管道必须落在 `\\.\pipe\zcode-cua-helper-`。`hold_key` / `hold_key_to_app` 的等待时间是 `max(timeout, min(duration,30)*1000+5000)`。
- PiP 客户端只属于 `pip-session-node.js`。它排队调用 `PermissionBrokerClient`，角色 `presentation`，协议 `2` / `zcode-cua-pip-session-v2`。事件 schema 与发布包 strict object 一致：`focus-changed`、`turn-started`、`turn-ended`、`session-closed`。握手不一致时记 `version_mismatch` 并不再发送。`broker_unavailable` 在 `reconnectAttempts` 内重试，其它错误立即抛出。诊断回调只发第一次。

### 云内容弹窗与营销 hero

发布包 renderer 的 styles chunk 渲染 `cloud-content-dialog`。资源 URL 与 zip 租约仍只属于 Host 的 `cloud-content`；弹窗自己的 pending、复制成功提示和焦点归还只活在弹窗组件里。

- Hero 视图类型是 `image`、`video`、`lottie`、`interactive_bundle`。营销 schema 仍只有 `image`、`video`、`bundle`。`resolveMarketingHero` 是唯一投影：image/video 先解码再交给视图；`bundle` 仅桌面端 `prepare`，运行时 `zcode-hero-sandbox-v1`，通道 `zcode-cloud-hero-v1`。没有 media port 时 hero 为空，不另开下载。
- Lottie 只从 `lottie-web` 5.13.0 的 `lottie_light_canvas` 动态加载。文档校验拒绝外链、字体、表达式和超限帧；下载超过 2MiB 失败。失败且有 fallback 时回退图片。
- 弹窗按钮动作由 `buildCloudDialogPayload` 从 popup 拷贝生成。除 `plugin_marketplace` 记为 `plugin_store` 外，navigate 在视图里收成 `settings`；执行时仍用按钮序号回查原始 action。
- 活动展示的唯一所有者是 `createMarketingTouchController`。它保存 banner、待展示 popup、对话框、pending 和错误。Hero URL 与 zip 租约仍只经过 `resolveMarketingHero`。轮询器只负责按可见性和退避调用 `refresh`，不保存投放内容。
- 生产环境轮询间隔 10 分钟，其它环境 30 秒。查询失败后的退避是 `min(600000, 30000 * 2^min(fails-1, 5))`。查询连续失败超过 10 分钟且没有进行中的动作时清掉 banner。可见性隐藏、已有对话框、领取错误或页面上已有 dialog / alertdialog / 升级面时，不新开 popup。
- 导航请求只有 `marketingNavigationStore` 一份。设置分区沿用 `setPendingSettingsSectionIntent` 与 `openSettingsTab`；设置页在当前分区已经落到目标且没有 `provider_id` 时确认。带 `provider_id` 的确认只在模型设置里完成，并且只接受现有 Coding Plan provider id。插件市场沿用 `requestPluginStoreOpen` 与当前 workspace tab；商店页在列表或对应详情出现后确认。升级沿用 `openCodingPlanUpgrade` 的观察回调。确认前若已有导航请求，拒绝为 `marketing_navigation_busy`。30 秒未确认是 `marketing_capability_timeout`。
- 领取在验证码配置不可用时取消，并使用 `manualClaimPlan.claim.failure.captcha`。配置可用时走下面的 Aliyun runner，source 是 `send_preflight`，不另造 verify param。成功后的权益刷新只调用现有 start-plan entitlement 与 `providerSettingsService.refresh`。预热失败由 runner 吞掉；banner 只在调用本身被拒绝时记 `[marketing-touch] captcha prewarm failed; click will retry`。
- 侧栏 footer 挂 banner。会话从非 `completedSuccess` 进入 `completedSuccess` 时触发一次轮询。没有 marketing 服务或正在恢复登录时不创建控制器。

### Aliyun 验证码 runner

发布包 styles 里的 Aliyun 验证码只有一份运行时，所有者是 `captchaRuntime`。配置缓存、脚本、SDK 控制器、进行中的验证和 certifyId 都在这里。营销领取和 Start Plan 的 provider runtime headers 调用它，不另建客户端。Main 的 `[captcha-network]` 分类仍只属于 `captchaNetworkDiagnostics`。

- 脚本是 `https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js`。`window.initAliyunCaptcha` 已存在则直接复用。配置缓存 TTL 60 秒，失败不写入，同时只有一个 in-flight。`enabled === false` 或缺 `region`、`prefix`、`sceneId` 视为不可用。语言读 `zcode-locale-preference`：`zh-CN` 为 `cn`，`en-US` 为 `en`，`system` 或空值再看 `navigator.language`。
- 隐藏宿主挂在 Root，不随欢迎页或启动壳切换卸载。DOM id 是 `zcode-aliyun-captcha-container`、`zcode-aliyun-captcha-element`、`zcode-aliyun-captcha-button`。默认 logo 是发布包内联的 PNG data URL。
- 同一时刻只允许一轮验证。队列按调用顺序放行。默认先无痕，8 秒无响应且允许交互时点击隐藏按钮。交互超时 120 秒，实例等待 10 秒。脚本加载后至少等 2 秒再触发。`F008` 且正文含 `重复提交` 或 `只允许提交一次` 时重置控制器。`T006` 或 `success && verifyResult` 视为通过。无痕超时若已经在等 SDK 的延迟成功，则不取消这一轮。
- 验证结果只写入 `X-Aliyun-Captcha-Verify-Param` 与可选的 `X-Aliyun-Captcha-Verify-Region`。ARMS 事件名 `aliyun_captcha_verification`，group `captcha`。reporter 由 Root 设为 platform，失败记 `[captcha] ARMS 自定义事件上报失败`。
- 每个 workspace key 在 rpc 就绪后订阅一次 `onDynamicWorkspaceProviderRuntimeHeadersRequest` 和 `Cancelled`。进行中的请求按 identity、sessionId、requestId 合并。只有 `access.type === "zhipu-account"` 且 `mode === "start-plan"` 才跑验证码；其它请求应答 `headersApplied: false`。取消用 `AbortError`，消息是 `Captcha request cancelled`。reason 为 `captcha-retry` 时 source 是 `captcha_retry`，否则是 `send_preflight`。

```text
Root 挂载隐藏宿主 + 每个 workspace 订阅
  → getCaptchaConfig（60s 缓存）
  → 不可用：领取取消 / headersApplied false
  → Start Plan 或领取：加载脚本 → initAliyunCaptcha → 无痕或交互
  → respondProviderRuntimeHeaders 只带两枚验证码头
```

### 手机远控弹窗与 Bots 配置

发布包 renderer 在桌面侧栏 footer 挂 `web-remote-control` 入口，弹窗与 Bots 配置只提交平台调用和 `IBotsService` 请求，不另存 relay 会话。

- 平台方法只在 `IPlatformService`：`startWebRemoteControl`、`refreshWebRemoteControlPairing`、`stopWebRemoteControl`、`getWebRemoteControlStatus`、`onWebRemoteControlStatusChanged`。Desktop preload 转到已有 main IPC。会话状态仍只由 `createWebRemoteControlManager` 写出。
- 功能开关默认开启。footer 仅在桌面且已有 workspace 路径时挂紧凑入口。入口点击上报 `web_remote_control_entry_view`。弹窗打开时若当前 workspace 已有会话，或已有手机连接，则复用状态；`cancelled` 收成 `idle`。状态轮询 1 秒，二维码来自 `qrUrl`。
- 失败文案按 `failure.reason` 映射。`session-conflict` 且 message 含 `kicked` 时用 kicked 文案。刷新配对前确认；停止后把本地状态收成 `idle`。
- Bots 对话框是配置 UI 的唯一所有者。配置、运行状态和绑定码轮询都走现有 `IBotsService`。`listWorkspaceRefs` 接受当前 workspace，这样历史为空时列表仍包含正在配置的工作区。绑定码 TTL 使用 `BOT_BIND_CODE_TTL_MS`。飞书/Lark 与微信扫码注册沿用现有 begin/poll。Bots 不调用验证码。
- 飞书与 Lark 共用发布包 styles 里内联的 PNG。Telegram、微信、钉钉、Discord、企业微信的 `new URL` 图标没有打进 AppImage，界面改用现有 `Bot` / `Webhook` 图标，不伪造哈希文件名。钉钉只出现在新建列表里，不进入 `BotProviderId`。

### 手机远控任务首页

发布包在 `WorkspaceShellLayout` 收到 `webRemoteControlWorkspaceSwitcher` 且视口匹配 `(max-width: 767px)` 时，用手机壳替换桌面分栏。壳只投影 switcher 给出的 workspace/task 列表，不另建已接受会话队列。

- 列表、重连、切 workspace、新建草稿、`updateMobileViewState` 和 `markTaskRead` 都只调用注入的 switcher。Renderer 保存当前展示快照、展开的 workspace key，以及 `localStorage` 键 `zcode-web-remote-control-mobile-task-home-preferences` 里的整理/排序。页面 `home | chat` 走 `history.state.zcodeMobilePage`。
- 没有初始列表时调用 `listWorkspaces()`。`onWorkspaceListUpdated` 整表替换快照。`refreshKey` 从 1 起再次拉取；回到首页会先加一。
- 未归档任务参与计数。置顶和时间线服从用户的 `created | updated`，运行中或 `hasBackgroundWork` 的任务按创建时间置顶。工作区分组固定按 `updated` 排序，与发布包一致。远程且 `disconnected` 或缺 `remoteSessionId` 时禁用任务并显示重连。
- 同一 workspace 打开任务时可选标记已读，再走现有 `onSelectTask` 和 `updateMobileViewState`。跨 workspace 把 `mobileNavigationIntent: "chat"` 交给 `switchWorkspace`。错误含 `远程工作区尚未连接` 或 `请先重连` 时回到首页。当前壳不会因切换卸载，成功后清掉切换遮罩。
- 远控 switcher 存在时，选择任务跳过本地 tab 补开，只回到 chat 并调用已有 `handleSelectTask`。窄屏 header 复用 `simplifyForNarrowRemote`。
- Switcher 的构造不在 renderer 里，本层不实现第二套会话所有者。没有 switcher 时保持桌面壳。

### 远控侧栏的窄屏布局

发布包 `AnimatedSidePanePanel` 接受 `mobileOverlay` 与 `mobileStacked`。这两个标志只由 `WorkspaceShellLayout` 决定，面板不另读 switcher，也不另存一份已打开状态。

- `mobileStacked` 等于 switcher 是否存在。窄屏样式挂在 `max-md:` 上，桌面宽度仍是左右分栏。
- 手机壳（switcher 且 `(max-width: 767px)`）把侧栏渲染成 `mobileOverlay`。这时不用可调整面板：尺寸为 100%，可见性直接是 `isSidePaneOpen`，窗口控件和截图 surface 关闭。外框不写 `data-workspace-side-frame`，也不套桌面圆角。面板引用用壳上单独的 overlay ref，不复用桌面 `useAnimatedResizablePanel` 的 ref。
- 有 switcher 但不是 overlay 时，可调整面板在窄屏改为 `max-md:!h-[min(45dvh,24rem)]`、顶边框，并隐藏分隔条。外框去掉圆角和边框，宽度拉满。
- 粗指针窄屏 `(max-width: 767px) and (hover: none) and (pointer: coarse)` 由侧栏面板自己订阅。overlay 或该视口为真时不提供辅助对话入口。overlay 时预览重内容保持挂载。

### 桌面远控导航收起

发布包在同一个 `WorkspaceShellLayout` 里，手机视口走任务首页，桌面分栏仍保留导航高度状态。导航高度和收起标志只属于这个壳；侧栏只在打开任务时通知是否跨 workspace。

- 视口查询仍是 `(max-width: 767px)`，只有 switcher 存在时才订阅变化。展开高度是 `round(clamp(viewport * 0.5 - 48, 0, 352))`。拖拽上限是 `max(0, round(viewport - 48 - 168))`。高度小于等于 24 视为收起。
- 单击把手在展开和上述展开高度之间切换。拖拽超过 4px 才改高度，松手时再按同一规则吸附。`pointercancel` 不提交。
- 手机视口上打开任务会收起导航。跨 workspace 时写入 `sessionStorage` 键 `zcode:web-remote-control:collapse-navigation-once`，下次壳初始化读到后删除并直接收起。桌面宽度不写这个键。
- 侧栏面板在窄屏用 `--web-remote-navigation-height`。收起时高度为 0 并隐藏。竖向分隔条在窄屏隐藏。Switcher 存在时禁用分屏入口，并把 automations / plugin-store 收成 chat。
- 模式文案表只给现有 `ConfigSelect` 查 `mode.label.*` / `mode.description.*`。不把 claude、codex、gemini、opencode 加进 `ZCodeProvider`。

### 桌面远控任务索引

发布包侧栏在 `webRemoteControlWorkspaceSwitcher` 存在，且视图是 workspace、timeline 或 archived 时，用 `WebRemoteControlTaskIndex` 替换本地任务区。列表真值仍只来自 switcher；索引只保存当前展示快照、加载错误和本轮置顶/归档请求。

- `listWorkspaces()` 在挂载和依赖变化时拉取。已有 `activeTaskId` 且任务数为 0 时，最多再等 3 次，每次 300ms，并记录 `[WebRemoteControlTaskIndex] 远控任务索引为空，等待桌面任务快照同步`。失败记录 `加载远程 task 索引失败`。`onWorkspaceListUpdated` 整表替换快照并清掉加载错误。
- 分组、时间线和归档都复用手机首页的运行层排序。搜索匹配 title、workspaceLabel、workspacePath、workspaceIdentity、remoteSessionId。分组内固定按 `updated`。收起的 workspace key 只留在侧栏内存，不写入 grouped 任务的 localStorage。
- 有 active workspaceIdentity 时，只有远程 workspace 能解析到 task service。远程会话服务来自现有 remote session store；本地 workspace 用当前 `useServices()`。断连或重连中的 workspace 不参与批量删除归档。
- 置顶、归档、取消归档和删除归档都调用该 workspace 已有的 `IZCodeTaskService`。成功后只改展示快照。置顶和归档失败用现有 toast；取消归档和删除失败只记 `[WebRemoteControlTaskIndex]` 警告。
- 打开任务先通知侧栏是否跨 workspace。同一 workspace 走现有 `onSelectTask`，并调用 switcher 的 `updateMobileViewState`。跨 workspace 只调用 `switchWorkspace`。成功后不清除壳上的切换标志；失败才清。壳在该标志为真时盖住会话列并显示 `common.loading`。
- 侧栏另有一条 effect：active task 变化时调用 `updateMobileViewState`，失败记 `[WorkspaceSidebar] 同步远控 mobileViewState 失败`。Switcher 存在时隐藏本地置顶区，并把 grouped 视图按 workspace 交给索引。工具栏渲染在索引内部、置顶区之前。
- Switcher 的构造仍不在 renderer。没有 switcher 时继续用本地任务区。

### 任务菜单里的 provider 配置与错误文案

发布包任务菜单在复制 session id 之后提供「前往配置」。配置路径只由 `IZCodeTaskService.getWorkspaceProviderConfigFile` 回答；菜单和 hook 不另存一份已接受路径。

- 发布包 host 固定返回 `provider: "glm"`、`path: workspacePath`、`exists: false`。请求里的 provider 与 workspaceIdentity 不参与探测，也不补一套未出现在发布包里的 CLI 配置文件查找。
- 有 `remoteSessionId` 时查询走 base task service，否则走当前 workspace 的 task service。workspaceIdentity 已标记远程但会话 id 还没解析出来时不发请求。过期 generation 丢弃。
- `exists === false` 时打开父目录。盘符根目录保持 `X:\\`。优先用上次选择的已安装编辑器，失败再交给现有 `openInFileManager`。手机远控隐藏该菜单项。
- 个人市场 id `claude-plugins-official` 的分组标题使用 `settings.plugins.marketplace.claudeCodePlugins`。它不是官方市场，也不恢复已下线的 pluginNames 精选名单。列表分组 memo 和市场源对话框都无条件格式化这条文案。该 id 排在官方市场之后，不能移除，刷新失败也不展示。
- `CLAUDE_UNKNOWN_COMMAND` 在「没有可用模型」之后、provider business 文案之前解析。消息匹配 `Claude Code 未知命令 <command>（参数：<args>）。` 时分别使用 `zcode.error.CLAUDE_UNKNOWN_COMMAND` 与 `_WITH_ARGS`。解析失败则显示原始 message，不再走后续本地化。

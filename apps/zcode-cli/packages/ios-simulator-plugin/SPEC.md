# iOS Simulator 插件

从已发布 AppImage（构建提交 `cead36fd`）恢复的官方插件。`src/` 是源码。`dist/` 只由构建生成，不入库。

## 所有者

插件进程里的 MCP server（`ios-simulator` / `0.1.0`）是工具调用的唯一入口。模拟器选择和 xcodebuild 日志不在 Desktop 或 Host 再存一份。

## 行为

- 传输是 stdio。`import.meta.main` 为真时调用 `main()`。
- 每个工具由 `guard` 包住。异常变成 `fail(message)`，进程不退出。
- 安装包路径经 `file()` 解析：绝对路径原样使用，相对路径必须落在当前工作目录内。
- 该插件面向 macOS 上的 Xcode Simulator。非 macOS 环境由 `preflight` 报告缺失，不在 Desktop 里模拟一套第二状态。

## 工具

`ios_preflight`、`ios_list_simulators`、`ios_boot_simulator`、`ios_show_simulator`、`ios_discover_project`、`ios_create_app`、`ios_build_app`、`ios_build_and_run`、`ios_install_app`、`ios_launch_app`、`ios_terminate_app`、`ios_open_url`、`ios_screenshot`、`ios_logs`、`ios_ui_status`、`ios_ui_tap`、`ios_ui_swipe`、`ios_ui_type_text`、`ios_ui_button`、`ios_ui_describe`。

## 构建

`pnpm --filter @zcode/ios-simulator-plugin typecheck` 使用 `tsc --noEmit`。`build` 先 `tsc` 再由 `scripts/build-mcp.mjs` 把 `src/mcp/server.ts` 打成 `dist/mcp/server.js`。

## 验收

对 `src` 执行 `tsc` 后，`lib/` 与 `providers/` 的 `.js` 必须与 AppImage 中对应的未打包产物逐字节一致。`dist/mcp/server.js` 是 esbuild 包，不作为源码。

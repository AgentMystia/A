# Android Emulator 插件

从已发布 AppImage（构建提交 `cead36fd`）恢复的官方插件。`src/` 是源码。`dist/` 只由构建生成，不入库。

## 所有者

插件进程里的 MCP server（`android-emulator` / `0.1.0`）是工具调用的唯一入口。设备、AVD 和 Gradle 日志不在 Desktop 或 Host 再存一份。

## 行为

- 传输是 stdio。`import.meta.main` 为真时调用 `main()`。
- 每个工具由 `guard` 包住。异常变成 `fail(message)`，进程不退出。
- `inside` 拒绝逃出当前工作目录的路径。
- `adb` serial 必须匹配 `SERIAL`，应用 id 必须匹配 `PACKAGE`。

## 工具

`android_preflight`、`android_discover_project`、`android_create_app`、`android_build_app`、`android_build_and_run`、`android_list_devices`、`android_list_avds`、`android_start_emulator`、`android_stop_emulator`、`android_create_avd`、`android_install_app`、`android_launch_app`、`android_terminate_app`、`android_open_url`、`android_screenshot`、`android_logs`、`android_ui_status`、`android_ui_describe`、`android_ui_resolve`、`android_ui_tap`、`android_ui_swipe`、`android_ui_type_text`、`android_ui_keyevent`。

## 构建

`pnpm --filter @zcode/android-emulator-plugin typecheck` 使用 `tsc --noEmit`。`build` 先 `tsc` 再由 `scripts/build-mcp.mjs` 把 `src/mcp/server.ts` 打成 `dist/mcp/server.js`。

## 验收

对 `src` 执行 `tsc` 后，`lib/` 与 `providers/` 的 `.js` 必须与 AppImage 中对应的未打包产物逐字节一致。`dist/mcp/server.js` 是 esbuild 包，不作为源码，也不要求和未打包的 `server.ts` 逐字节相同。

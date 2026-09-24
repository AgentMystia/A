import { initializeRuntimeProcessEnv } from "./runtime-tools/runtimeCommandEnv.js";

// 发布包 host 的 paths chunk 同时被 index 和 tasks storage worker 加载。
// 运行时 PATH / login shell 只给 Host index 用；这里的引用没有运行时效果，
// 只让 esbuild 把它放进 paths chunk，而不是内联进 index。
void initializeRuntimeProcessEnv;

export { prepareTasksIndexStorage } from "#src/session/tasksDatabase/startup.js";
export { markTasksStoragePrepared } from "#src/session/tasksDatabase/prepared.js";
export { getTasksIndexDatabasePath } from "#src/paths.js";
export { resolveDefaultZCodeAgentCommand } from "#src/zcode-agent/zcodeAgentProcessManager.js";
export { resolveZCodeAgentSpawnCwd } from "#src/zcode-agent/zcodeAgentSpawnCwd.js";

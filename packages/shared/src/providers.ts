import { z } from "zod";

/**
 * 发布包进程事件和持久化 task meta 共用这一份历史 provider zod。
 * 运行时类型 ZCodeProvider 仍只有 glm，定义在 zcode-task-types-core.ts。
 * 不要从枚举再导出同名类型，否则 claude/opencode 会进入运行时类型。
 */
const PUBLISHED_ZCODE_PROVIDER_VALUES = ["claude", "opencode", "gemini", "codex", "glm"] as const;

export const zcodeProviderSchema = z.enum(PUBLISHED_ZCODE_PROVIDER_VALUES);

import type { CommandAgentSource } from "./command-types.js";
import { zcodeProviderSchema } from "./providers.js";
import type { ZCodeProvider } from "./zcode-task-types-core.js";

export const ZCODE_AGENT_PROVIDER = "glm" satisfies ZCodeProvider;
export const ZCODE_AGENT_PROVIDER_LABEL = "ZCode Agent";
export const ZCODE_COMMAND_AGENT_SOURCE = "zcodeAgent" satisfies CommandAgentSource;

/** 与 zcodeProviderSchema 是同一个对象。再写 z.literal("glm") 会在 model selection 前多一个模块。 */
export const zcodeAgentProviderSchema = zcodeProviderSchema;

export const ZCODE_COMMAND_AGENT_SOURCES = [
  ZCODE_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

// 发布包 host 忽略入参并固定返回 glm。bot 草稿 provider 也调用它，所以入参不收窄成 ZCodeProvider。
export function normalizeAgentProviderToZCodeAgent(_provider?: string | null): ZCodeProvider {
  return ZCODE_AGENT_PROVIDER;
}

export function isZCodeAgentProvider(
  provider: ZCodeProvider | null | undefined,
): provider is typeof ZCODE_AGENT_PROVIDER {
  return provider === ZCODE_AGENT_PROVIDER;
}

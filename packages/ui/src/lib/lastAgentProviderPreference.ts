import { normalizeAgentProviderToZCodeAgent, type ZCodeProvider } from "@zcode/shared";

const LAST_AGENT_PROVIDER_STORAGE_KEY = "zcode-last-agent-provider";

interface LastAgentProviderStorage {
  setItem(key: string, value: string): void;
}

function readLastAgentProviderStorage(): LastAgentProviderStorage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 发布包在 startDraft 写入这个键。localStorage 不可用时跳过。 */
export function persistLastAgentProvider(
  provider: ZCodeProvider,
  storage: LastAgentProviderStorage | null = readLastAgentProviderStorage(),
): void {
  storage?.setItem(LAST_AGENT_PROVIDER_STORAGE_KEY, normalizeAgentProviderToZCodeAgent(provider));
}

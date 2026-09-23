import type { AppRuntimePreferencesChangedBroadcastPayload } from "@zcode/shared";

export interface AppRuntimePreferenceSyncTarget {
  syncAppRuntimePreferences(
    preferences: AppRuntimePreferencesChangedBroadcastPayload,
  ): Promise<unknown>;
}

/**
 * 设置保存成功后，把同一份已接受偏好投影到 agent 与 bots。
 * 两侧都要发起；先失败的原因在广播发出之后才抛出，不取消广播，也不回滚另一侧。
 */
export async function deliverAcceptedAppRuntimePreferences(input: {
  zcodeAgentService: AppRuntimePreferenceSyncTarget;
  botsService: AppRuntimePreferenceSyncTarget;
  preferences: AppRuntimePreferencesChangedBroadcastPayload;
  broadcast(preferences: AppRuntimePreferencesChangedBroadcastPayload): Promise<unknown>;
}): Promise<void> {
  const syncResults = await Promise.allSettled([
    input.zcodeAgentService.syncAppRuntimePreferences(input.preferences),
    input.botsService.syncAppRuntimePreferences(input.preferences),
  ]);
  const syncError = syncResults.find((result) => result.status === "rejected")?.reason;
  await input.broadcast(input.preferences);
  if (syncError) {
    throw syncError;
  }
}

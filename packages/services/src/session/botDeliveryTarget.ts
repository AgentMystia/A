import { zcodeBotDeliveryTargetSchema, type ZCodeBotDeliveryTarget } from "@zcode/shared";
import type { IBotsService } from "#src/bots/bots.js";

/** 发布包 host schema `ar` / `cf` 的持久化解析。解析失败不是投递目标。 */
export function parseStoredBotDeliveryTarget(raw: string): ZCodeBotDeliveryTarget | undefined {
  try {
    const parsed = zcodeBotDeliveryTargetSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 发布包 host `watchCronRunBotDelivery`。
 * 唯一读取是 repo；没有目标时不订阅。订阅失败由 dispatch 记录，不在这里吞掉。
 */
export async function watchCronRunBotDelivery(params: {
  automationId: string;
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
  repo: {
    getBotDeliveryTarget(
      automationId: string,
      workspaceKey: string,
    ): Promise<ZCodeBotDeliveryTarget | undefined>;
  };
  botsService: Pick<IBotsService, "watchAutomationRun">;
}): Promise<boolean> {
  const target = await params.repo.getBotDeliveryTarget(params.automationId, params.workspaceKey);
  if (!target) return false;
  await params.botsService.watchAutomationRun({
    target,
    taskId: params.taskId,
    workspacePath: params.workspacePath,
    ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
  });
  return true;
}

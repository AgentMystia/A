import type { ZCodeBotDeliveryTarget } from "@zcode/shared";
import type { IBotsService } from "#src/bots/bots.js";

/**
 * 发布包 host index 的 `watchCronRunBotDelivery`。
 * 必须和 `parseStoredBotDeliveryTarget` 分文件：tasks storage worker 会经
 * AutomationRepo 到达解析函数，同一模块会把订阅函数打进 host paths chunk。
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

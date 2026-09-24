import { zcodeBotDeliveryTargetSchema, type ZCodeBotDeliveryTarget } from "@zcode/shared";

/** 发布包 host schema 的持久化解析。解析失败不是投递目标。 */
export function parseStoredBotDeliveryTarget(raw: string): ZCodeBotDeliveryTarget | undefined {
  try {
    const parsed = zcodeBotDeliveryTargetSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

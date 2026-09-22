// 发布包 renderer 把 Coding Plan 活动配置缓存在 hook 模块，TTL 1 小时。
// 失败不写入缓存；进行中的请求只有一份，设置页和会话条共用这一次读取。

export const CODING_PLAN_BILLING_DISCOUNT_CACHE_TTL_MS = 60 * 60 * 1000;

export interface CodingPlanBillingDiscountCopy {
  badgeBody?: string;
  cardTitle?: string;
  cardBody?: string;
  infoTitle?: string;
  infoBody?: string;
}

const COPY_FIELDS = [
  "badgeBody",
  "cardTitle",
  "cardBody",
  "infoTitle",
  "infoBody",
] as const satisfies readonly (keyof CodingPlanBillingDiscountCopy)[];

interface BillingDiscountCacheEntry {
  value: unknown;
  expiresAt: number;
}

let cached: BillingDiscountCacheEntry | null = null;
let inflight: Promise<unknown> | null = null;

export function readCodingPlanBillingDiscountCache(): BillingDiscountCacheEntry | null {
  return cached;
}

export function clearCodingPlanBillingDiscountCache(): void {
  cached = null;
  inflight = null;
}

function readTrimmedCopyField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readCodingPlanBillingDiscountCopy(
  config: unknown,
  locale: string,
): CodingPlanBillingDiscountCopy {
  if (!config || typeof config !== "object") return {};
  const localized = (config as Record<string, unknown>)[locale];
  if (!localized || typeof localized !== "object") return {};
  const record = localized as Record<string, unknown>;
  return {
    badgeBody: readTrimmedCopyField(record.badgeBody),
    cardTitle: readTrimmedCopyField(record.cardTitle),
    cardBody: readTrimmedCopyField(record.cardBody),
    infoTitle: readTrimmedCopyField(record.infoTitle),
    infoBody: readTrimmedCopyField(record.infoBody),
  };
}

export function isCodingPlanBillingDiscountCopyComplete(
  config: unknown,
  locale: string,
  fields: readonly (typeof COPY_FIELDS)[number][],
): boolean {
  const copy = readCodingPlanBillingDiscountCopy(config, locale);
  return fields.every((field) => Boolean(copy[field]));
}

export async function loadCodingPlanBillingDiscount(service: {
  getBillingDiscount: () => Promise<unknown>;
}): Promise<unknown> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  if (inflight) return inflight;
  const request = service.getBillingDiscount();
  inflight = request;
  try {
    const value = await request;
    cached = { value, expiresAt: now + CODING_PLAN_BILLING_DISCOUNT_CACHE_TTL_MS };
    return value;
  } finally {
    if (inflight === request) inflight = null;
  }
}

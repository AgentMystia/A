/** 发布包 host `readServerTimeMilliseconds`：接口秒值乘 1000。 */
export function readServerTimeMilliseconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value * 1000
    : undefined;
}

export interface ManualClaimEntitlementPreview {
  entitlementId: string;
  showName: string;
  meter: string;
  unitType: string;
  capabilities: unknown[];
  grantUnits: number;
  period: string;
  priority: number;
  effectiveAt?: number;
}

export interface ManualClaimPlanPreview {
  planId: string;
  name: string;
  description: string;
  priority: number;
  entitlements: ManualClaimEntitlementPreview[];
}

export interface ManualClaimPlanPreviews {
  serverTime?: number;
  plans: ManualClaimPlanPreview[];
}

export interface ManualClaimRequest {
  planId: string;
  captchaVerifyParam: string;
  captchaRegion?: string;
}

export interface ManualClaimedEntitlement {
  entitlementId: string;
  showName: string;
  effectiveAt?: number;
}

export interface ManualClaimedPlan {
  userPlanId: string;
  planId: string;
  status: string;
  startsAt?: number;
  endsAt?: number;
  entitlements: ManualClaimedEntitlement[];
}

export interface ManualClaimResult {
  success: boolean;
  code: number;
  message: string;
  serverTime?: number;
  failureEndsAt?: number;
  plan?: ManualClaimedPlan;
}

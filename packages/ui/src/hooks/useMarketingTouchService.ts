import { useServices } from "./useServices.js";

/**
 * 本机 Host 营销触达。远端 workspace / 未注册该频道时返回 null。
 */
export function useMarketingTouchService() {
  try {
    return useServices().marketingTouchService ?? null;
  } catch {
    return null;
  }
}

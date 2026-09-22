import { useServices } from "./useServices.js";

/**
 * 本机 Host 云内容 bundle 租约。远端 workspace / 未注册该频道时返回 null。
 */
export function useCloudContentService() {
  try {
    return useServices().cloudContentService ?? null;
  } catch {
    return null;
  }
}

import { useServices } from "./useServices.js";

/** Host bots 配置与 inbound 面。 */
export function useBotsService() {
  return useServices().botsService;
}

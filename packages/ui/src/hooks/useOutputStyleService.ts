import { useServices } from "./useServices.js";

/** 用户 ~/.claude/output-styles 读写面。 */
export function useOutputStyleService() {
  return useServices().outputStyleService;
}

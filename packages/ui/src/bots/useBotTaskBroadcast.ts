import { useEffect } from "react";
import type { IBroadcastService } from "@zcode/services";
import type { TabStore } from "@/store/tabStore.js";
import { handleBotTaskBroadcastMessage } from "@/bots/botTaskBroadcast.js";

/** Root 订阅 bot 任务广播。频道匹配和投影规则见 botTaskBroadcast。 */
export function useBotTaskBroadcast(
  services: { broadcastService: IBroadcastService },
  tabStore: Pick<TabStore, "getState">,
): void {
  useEffect(() => {
    const disposable = services.broadcastService.onMessage((message) => {
      handleBotTaskBroadcastMessage(message, tabStore.getState().tabs);
    });
    return () => {
      disposable.dispose();
    };
  }, [services.broadcastService, tabStore]);
}

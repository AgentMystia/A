import type { MessagePortMain } from "electron";
import type { MessagePortLike, MessagePortPayload } from "@zcode/rpc";

/** Main 的 tsconfig 以 src/main 为 rootDir，不能引用 host 里的同名适配器。 */
export function wrapElectronPort(port: MessagePortMain): MessagePortLike {
  return {
    addEventListener(_type: "message", listener: (event: { data: MessagePortPayload }) => void) {
      port.on("message", listener);
    },
    removeEventListener(_type: "message", listener: (event: { data: MessagePortPayload }) => void) {
      port.off("message", listener);
    },
    postMessage(data: MessagePortPayload) {
      port.postMessage(data);
    },
    start() {
      port.start();
    },
    close() {
      port.close();
    },
  };
}

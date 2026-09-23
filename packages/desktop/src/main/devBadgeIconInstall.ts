import { nativeImage } from "electron";
import {
  installDevBadgeIcon as installDevBadgeIconWithDeps,
  resolveAppIcon,
} from "./devBadgeIcon.js";
import { logger } from "./logger.js";

export { resolveAppIcon };

// 发布包把 logger 和 nativeImage 静态打进 main。
// 动态 import("./logger.js") 会多切一个 chunk，main JS 文件数会从 22 变成 23。
export const installDevBadgeIcon = (iconPath: string): Promise<void> =>
  installDevBadgeIconWithDeps(iconPath, {
    logger,
    createFromBuffer: (buffer) => nativeImage.createFromBuffer(buffer),
  });

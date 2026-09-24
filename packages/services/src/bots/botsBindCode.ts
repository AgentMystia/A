import { randomBytes } from "node:crypto";

/** 发布包 host `_le`：3 字节 hex 大写绑定码。 */
export const createBotBindCode = (() => {
  return (): string => randomBytes(3).toString("hex").toUpperCase();
})();

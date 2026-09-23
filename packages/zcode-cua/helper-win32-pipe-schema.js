import { z } from "zod";

import { isWindowsNamedPipePath } from "./helper-broker-runtime.js";

// 发布包把这个 zod 对象留在 main、host、scheduler，调用方没有引用。
// refine 必须调用 isWindowsNamedPipePath，否则那两个 bundle 会丢掉这个 keepName。
export const win32NamedPipeParentSchema = z.object({
  platform: z.literal("win32"),
  socketPath: z
    .string()
    .refine((socketPath) => isWindowsNamedPipePath(socketPath) && socketPath.length > 9),
  parentPid: z.coerce.number().int().positive(),
});

import type { ZodType } from "zod";

export declare const win32NamedPipeParentSchema: ZodType<{
  platform: "win32";
  socketPath: string;
  parentPid: number;
}>;

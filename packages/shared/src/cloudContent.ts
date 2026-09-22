import { z } from "zod";

const bundleUrlSchema = z
  .string()
  .max(4096)
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) {
      return false;
    }
    const parsed = new URL(value);
    return /^https?:$/u.test(parsed.protocol) && !parsed.username && !parsed.password;
  });

/** 发布包 host 的 zip bundle 契约。入口必须是 html。 */
export const cloudContentBundleSchema = z.object({
  format: z.literal("zip"),
  url: bundleUrlSchema,
  entry: z.string().min(1).max(240),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(8 * 1024 * 1024)
    .optional(),
});

export type CloudContentBundle = z.infer<typeof cloudContentBundleSchema>;

export interface CloudContentPrepareResult {
  leaseId: string;
  cacheHit: boolean;
  url: string;
}

export const CLOUD_CONTENT_LOOPBACK_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";

export const CLOUD_CONTENT_LOOPBACK_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

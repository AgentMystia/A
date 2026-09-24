import { cloudDialogBundleSchema, type CloudDialogBundle } from "../cloudDialogPayload.js";

/**
 * 发布包只保留 cloudDialogBundleSchema 这一份 zip zod。
 * 内容租约解析同一个对象，入口是否为 html 由 Host 解包路径校验，不在这里再写 schema。
 */
export const cloudContentBundleSchema = cloudDialogBundleSchema;

export type CloudContentBundle = CloudDialogBundle;

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

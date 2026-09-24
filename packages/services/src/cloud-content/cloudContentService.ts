import { createServer, type Server } from "node:http";
import { extname } from "node:path";
import { rm } from "node:fs/promises";
import { type MarketingAssetRef } from "@zcode/shared";
import {
  CLOUD_CONTENT_LOOPBACK_CSP,
  CLOUD_CONTENT_LOOPBACK_MIME,
  cloudContentBundleSchema,
  type CloudContentPrepareResult,
} from "@zcode/shared/cloud-content";
import type { MarketingAssetRegistry } from "../marketing-touch/marketingAssetRegistry.js";
import type { ICloudContentService } from "./cloudContent.js";
import { createContentBundleCache } from "./contentBundleCache.js";

export function createCloudContentService(options: {
  publishedAssets?: MarketingAssetRegistry;
  cacheRoot: string;
}): ICloudContentService {
  let disposed = false;
  let everPrepared = false;
  const abort = new AbortController();
  const inflight = new Set<Promise<unknown>>();
  const activeLeases = new Set<string>();
  const isTrustedUrl = (url: URL): boolean => options.publishedAssets?.allowsUrl(url) === true;
  const cache = createContentBundleCache({
    cacheRoot: options.cacheRoot,
    isTrustedUrl,
    signal: abort.signal,
  });

  const server: Server = createServer((request, response) => {
    void (async () => {
      if (disposed || request.method !== "GET") {
        response.writeHead(404).end();
        return;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      const [, leaseId, ...rest] = url.pathname.split("/");
      if (!leaseId || !activeLeases.has(leaseId)) {
        response.writeHead(404).end();
        return;
      }
      const relativePath = decodeURIComponent(rest.join("/"));
      const contentType = CLOUD_CONTENT_LOOPBACK_MIME[extname(relativePath).toLowerCase()];
      if (!contentType) {
        response.writeHead(404).end();
        return;
      }
      const body = await cache.read(leaseId, relativePath);
      response
        .writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": body.length,
          "Content-Security-Policy": CLOUD_CONTENT_LOOPBACK_CSP,
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Cache-Control": "no-store",
          "Cross-Origin-Resource-Policy": "cross-origin",
        })
        .end(body);
    })().catch(() => {
      if (!response.headersSent) {
        response.writeHead(404);
      }
      response.end();
    });
  });

  let origin: Promise<string> | undefined;

  function resourceOrigin(): Promise<string> {
    origin ??= new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("cloud_content_address"));
          return;
        }
        server.unref();
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    return origin;
  }

  return {
    async readPublishedMedia({ asset, kind }: { asset: MarketingAssetRef; kind: "image" | "video" }) {
      if (disposed || !options.publishedAssets) {
        throw new Error("cloud_content_disabled");
      }
      return options.publishedAssets.readMedia(asset, kind);
    },
    async prepare({ bundle }): Promise<CloudContentPrepareResult> {
      const parsed = cloudContentBundleSchema.parse(bundle);
      if (disposed) {
        throw new Error("cloud_content_disposed");
      }
      if (!options.publishedAssets?.allows({ src: parsed.url, sha256: parsed.sha256 })) {
        throw new Error("cloud_content_source");
      }
      const task = (async () => {
        everPrepared = true;
        const lease = await cache.acquire(parsed);
        activeLeases.add(lease.leaseId);
        if (disposed) {
          await cache.release(lease.leaseId);
          activeLeases.delete(lease.leaseId);
          throw new Error("cloud_content_disposed");
        }
        try {
          const originUrl = await resourceOrigin();
          return {
            leaseId: lease.leaseId,
            cacheHit: lease.cacheHit,
            url: `${originUrl}/${lease.leaseId}/${lease.entry.split("/").map(encodeURIComponent).join("/")}`,
          };
        } catch (error) {
          activeLeases.delete(lease.leaseId);
          await cache.release(lease.leaseId);
          throw error;
        }
      })();
      inflight.add(task);
      try {
        return await task;
      } finally {
        inflight.delete(task);
      }
    },
    async release({ leaseId }) {
      activeLeases.delete(leaseId);
      await cache.release(leaseId);
    },
    async disposeAllAndWait() {
      disposed = true;
      abort.abort();
      await Promise.allSettled(inflight);
      if (origin) {
        await origin.catch(() => undefined);
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
      }
      await Promise.all([...activeLeases].map((leaseId) => cache.release(leaseId)));
      activeLeases.clear();
      if (everPrepared) {
        await rm(options.cacheRoot, { recursive: true, force: true });
      }
    },
  };
}

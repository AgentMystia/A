import { createHash } from "node:crypto";
import {
  marketingAssetRefSchema,
  type MarketingAssetRef,
  type MarketingTouchSnapshot,
} from "@zcode/shared";

export interface MarketingAssetRegistry {
  allow(asset: MarketingAssetRef): void;
  allows(asset: MarketingAssetRef): boolean;
  allowsUrl(url: URL): boolean;
  accept(snapshot: MarketingTouchSnapshot): void;
  readMedia(asset: MarketingAssetRef, kind: "image" | "video"): Promise<string>;
}

const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const VIDEO_MAX_BYTES = 16 * 1024 * 1024;
const DATA_URL_BUDGET_BYTES = 48 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function sniffMediaType(bytes: Buffer, kind: "image" | "video"): string | undefined {
  if (kind === "video") {
    return bytes.toString("ascii", 4, 8) === "ftyp" ? "video/mp4" : undefined;
  }
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return "image/jpeg";
  }
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return undefined;
}

function allowVisual(allow: (asset: MarketingAssetRef) => void, visual: unknown): void {
  const value = visual as
    | { type: "image"; image: { default: MarketingAssetRef; dark?: MarketingAssetRef | null } }
    | { type: "video"; video: { src: MarketingAssetRef; fallback: MarketingAssetRef } }
    | {
        type: "bundle";
        bundle: { bundle: MarketingAssetRef; fallback?: MarketingAssetRef | null };
      }
    | null
    | undefined;
  if (!value) {
    return;
  }
  if (value.type === "image") {
    allow(value.image.default);
    if (value.image.dark) {
      allow(value.image.dark);
    }
  } else if (value.type === "video") {
    allow(value.video.src);
    allow(value.video.fallback);
  } else {
    allow(value.bundle.bundle);
    if (value.bundle.fallback) {
      allow(value.bundle.fallback);
    }
  }
}

export function createMarketingAssetRegistry(options: {
  allowLoopback?: boolean;
  fetch?: typeof fetch;
} = {}): MarketingAssetRegistry {
  const allowed = new Map<string, Set<string>>();
  const cache = new Map<string, { data: string; size: number }>();
  const inflight = new Map<string, Promise<string>>();
  let cacheBytes = 0;

  function allow(asset: MarketingAssetRef): void {
    const parsed = marketingAssetRefSchema.parse(asset);
    const url = new URL(parsed.src);
    const loopback =
      options.allowLoopback === true && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !loopback) {
      return;
    }
    if (!allowed.has(parsed.src) && allowed.size >= 512) {
      allowed.delete(allowed.keys().next().value as string);
    }
    const hashes = allowed.get(parsed.src) ?? new Set<string>();
    if (hashes.size >= 8) {
      hashes.delete(hashes.values().next().value as string);
    }
    hashes.add(parsed.sha256);
    allowed.set(parsed.src, hashes);
  }

  function allows(asset: MarketingAssetRef): boolean {
    return allowed.get(asset.src)?.has(asset.sha256) === true;
  }

  async function download(asset: MarketingAssetRef, kind: "image" | "video"): Promise<string> {
    const response = await (options.fetch ?? fetch)(asset.src, {
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || !response.body) {
      throw new Error("marketing_asset_download");
    }
    const limit = (kind === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > limit) {
        throw new Error("marketing_asset_size");
      }
      chunks.push(buffer);
    }
    const bytes = Buffer.concat(chunks);
    if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
      throw new Error("marketing_asset_integrity");
    }
    const mediaType = sniffMediaType(bytes, kind);
    if (!mediaType) {
      throw new Error("marketing_asset_type");
    }
    const dataUrl = `data:${mediaType};base64,${bytes.toString("base64")}`;
    while (cacheBytes + dataUrl.length > DATA_URL_BUDGET_BYTES && cache.size > 0) {
      const oldest = cache.keys().next().value as string;
      cacheBytes -= cache.get(oldest)?.size ?? 0;
      cache.delete(oldest);
    }
    cache.set(`${kind}:${asset.sha256}`, { data: dataUrl, size: dataUrl.length });
    cacheBytes += dataUrl.length;
    return dataUrl;
  }

  return {
    allow,
    allows,
    allowsUrl: (url) => allowed.has(url.href),
    accept(snapshot) {
      for (const delivery of snapshot.deliveries) {
        if (delivery.resource_position === "banner") {
          allowVisual(allow, delivery.banner.background);
          allowVisual(allow, delivery.banner.success_popup?.hero);
        } else {
          allowVisual(allow, delivery.popup.hero);
        }
      }
    },
    async readMedia(asset, kind) {
      const parsed = marketingAssetRefSchema.parse(asset);
      if (!allows(parsed)) {
        throw new Error("marketing_asset_source");
      }
      if (kind !== "image" && kind !== "video") {
        throw new Error("marketing_asset_type");
      }
      const cacheKey = `${kind}:${parsed.sha256}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return cached.data;
      }
      const pending = inflight.get(cacheKey);
      if (pending) {
        return pending;
      }
      const request = download(parsed, kind);
      inflight.set(cacheKey, request);
      try {
        return await request;
      } finally {
        inflight.delete(cacheKey);
      }
    },
  };
}

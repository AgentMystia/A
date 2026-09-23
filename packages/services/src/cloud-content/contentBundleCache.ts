import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, utimes, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { cloudContentBundleSchema, type CloudContentBundle } from "@zcode/shared";
import { BUNDLE_MANIFEST_FILE_NAME, validateContentBundlePath } from "./contentBundlePath.js";
import {
  BUNDLE_CACHE_MAX_BYTES,
  BUNDLE_EXPANDED_MAX_BYTES,
  BUNDLE_FILE_MAX_BYTES,
  extractContentBundle,
  type ContentBundleManifest,
} from "./contentBundleExtract.js";

export interface ContentBundleLease {
  leaseId: string;
  sha256: string;
  entry: string;
  cacheHit: boolean;
}

export interface ContentBundleCache {
  acquire(bundle: CloudContentBundle): Promise<ContentBundleLease>;
  read(leaseId: string, relativePath: string): Promise<Buffer>;
  release(leaseId: string): Promise<void>;
  clear(): Promise<void>;
}

function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createContentBundleCache(options: {
  cacheRoot: string;
  isTrustedUrl: (url: URL) => boolean;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}): ContentBundleCache {
  const leases = new Map<string, { digest: string; manifest: ContentBundleManifest }>();
  let exclusiveTail = Promise.resolve();

  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = exclusiveTail.then(operation);
    exclusiveTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function trustedUrl(value: string): URL {
    const url = new URL(value);
    if (
      !/^https?:$/u.test(url.protocol) ||
      url.username ||
      url.password ||
      !options.isTrustedUrl(url)
    ) {
      throw new Error("bundle_source");
    }
    return url;
  }

  async function download(bundle: CloudContentBundle): Promise<Buffer> {
    let url = trustedUrl(bundle.url);
    const timeout = AbortSignal.timeout(30_000);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    for (let attempt = 0; attempt <= 3; attempt += 1) {
      const response = await (options.fetch ?? globalThis.fetch)(url, {
        redirect: "manual",
        signal,
        credentials: "omit",
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) {
          throw new Error("bundle_redirect");
        }
        url = trustedUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error("bundle_download");
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += (chunk as Uint8Array).byteLength;
        if (
          size > BUNDLE_FILE_MAX_BYTES ||
          (bundle.sizeBytes !== undefined && size > bundle.sizeBytes)
        ) {
          throw new Error("bundle_download_size");
        }
        chunks.push(Buffer.from(chunk));
      }
      if (bundle.sizeBytes !== undefined && size !== bundle.sizeBytes) {
        throw new Error("bundle_download_size");
      }
      const bytes = Buffer.concat(chunks);
      if (hashBytes(bytes) !== bundle.sha256) {
        throw new Error("bundle_integrity");
      }
      return bytes;
    }
    throw new Error("bundle_redirect_limit");
  }

  async function checkedRead(
    root: string,
    relativePath: string,
    expected: { sha256: string; size: number },
  ): Promise<Buffer> {
    validateContentBundlePath(relativePath);
    let current = root;
    const rootStat = await stat(current);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("bundle_cache_type");
    }
    for (const part of relativePath.split("/")) {
      current = join(current, part);
      if ((await stat(current)).isSymbolicLink()) {
        throw new Error("bundle_cache_symlink");
      }
    }
    const fileStat = await stat(current);
    if (
      !fileStat.isFile() ||
      fileStat.size !== expected.size ||
      fileStat.size > BUNDLE_FILE_MAX_BYTES
    ) {
      throw new Error("bundle_cache_size");
    }
    const bytes = await readFile(current);
    if (hashBytes(bytes) !== expected.sha256) {
      throw new Error("bundle_cache_integrity");
    }
    return bytes;
  }

  async function cached(digest: string): Promise<ContentBundleManifest | undefined> {
    const directory = join(options.cacheRoot, digest);
    try {
      const manifestPath = join(directory, BUNDLE_MANIFEST_FILE_NAME);
      const manifestStat = await stat(manifestPath);
      if (
        !manifestStat.isFile() ||
        manifestStat.isSymbolicLink() ||
        manifestStat.size > 64 * 1024
      ) {
        return undefined;
      }
      const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as ContentBundleManifest;
      if (
        !parsed.files ||
        !Number.isSafeInteger(parsed.size) ||
        parsed.size < 0 ||
        parsed.size > BUNDLE_EXPANDED_MAX_BYTES
      ) {
        return undefined;
      }
      const files = Object.entries(parsed.files);
      if (files.length > 128) {
        return undefined;
      }
      let size = 0;
      for (const [relativePath, file] of files) {
        await checkedRead(directory, relativePath, file);
        size += file.size;
      }
      return size === parsed.size ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async function evict(force: boolean): Promise<void> {
    const names = await readdir(options.cacheRoot).catch(() => [] as string[]);
    const entries = await Promise.all(
      names
        .filter((name) => /^[a-f0-9]{64}$/u.test(name))
        .map(async (name) => {
          const directory = join(options.cacheRoot, name);
          const directoryStat = await stat(directory);
          const manifest = await cached(name);
          return {
            name,
            directory,
            time: directoryStat.mtimeMs,
            size: manifest?.size ?? BUNDLE_EXPANDED_MAX_BYTES,
          };
        }),
    );
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries.sort((left, right) => left.time - right.time)) {
      if (!force && total <= BUNDLE_CACHE_MAX_BYTES) {
        break;
      }
      if (![...leases.values()].some((lease) => lease.digest === entry.name)) {
        await rm(entry.directory, { recursive: true, force: true });
        total -= entry.size;
      }
    }
  }

  return {
    acquire(bundle) {
      return exclusive(async () => {
        if (
          bundle.format !== "zip" ||
          !/^[a-f0-9]{64}$/u.test(bundle.sha256) ||
          (bundle.sizeBytes !== undefined &&
            (!Number.isSafeInteger(bundle.sizeBytes) ||
              bundle.sizeBytes <= 0 ||
              bundle.sizeBytes > BUNDLE_FILE_MAX_BYTES))
        ) {
          throw new Error("bundle_contract");
        }
        validateContentBundlePath(bundle.entry);
        if (!bundle.entry.endsWith(".html")) {
          throw new Error("bundle_entry");
        }
        trustedUrl(bundle.url);
        const stagingRoot = join(options.cacheRoot, "staging");
        await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
        let manifest = await cached(bundle.sha256);
        const cacheHit = Boolean(manifest);
        if (!manifest) {
          if ([...leases.values()].some((lease) => lease.digest === bundle.sha256)) {
            throw new Error("bundle_active_cache_corrupt");
          }
          const bytes = await download(cloudContentBundleSchema.parse(bundle));
          const staging = await mkdtempSafe(join(stagingRoot, "bundle-"));
          try {
            manifest = await extractContentBundle(bytes, staging);
            if (!Object.hasOwn(manifest.files, bundle.entry)) {
              throw new Error("bundle_entry_missing");
            }
            await writeFile(join(staging, BUNDLE_MANIFEST_FILE_NAME), JSON.stringify(manifest), {
              flag: "wx",
              mode: 0o600,
            });
            const destination = join(options.cacheRoot, bundle.sha256);
            await rm(destination, { recursive: true, force: true });
            await rename(staging, destination);
          } finally {
            await rm(staging, { recursive: true, force: true }).catch(() => undefined);
          }
        }
        if (!Object.hasOwn(manifest.files, bundle.entry)) {
          throw new Error("bundle_entry_missing");
        }
        const now = new Date();
        await utimes(join(options.cacheRoot, bundle.sha256), now, now);
        const leaseId = randomUUID();
        leases.set(leaseId, { digest: bundle.sha256, manifest });
        await evict(false);
        return { leaseId, sha256: bundle.sha256, entry: bundle.entry, cacheHit };
      });
    },
    read(leaseId, relativePath) {
      return exclusive(async () => {
        const lease = leases.get(leaseId);
        if (!lease) {
          throw new Error("bundle_lease");
        }
        validateContentBundlePath(relativePath);
        const file = Object.hasOwn(lease.manifest.files, relativePath)
          ? lease.manifest.files[relativePath]
          : undefined;
        if (!file) {
          throw new Error("bundle_resource_missing");
        }
        return checkedRead(join(options.cacheRoot, lease.digest), relativePath, file);
      });
    },
    release(leaseId) {
      return exclusive(async () => {
        leases.delete(leaseId);
        await evict(false);
      });
    },
    clear() {
      return exclusive(() => evict(true));
    },
  };
}

async function mkdtempSafe(prefix: string): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(prefix);
}

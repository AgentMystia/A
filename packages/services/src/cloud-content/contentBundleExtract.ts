import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fromBuffer, type Entry, type ZipFile } from "yauzl";
import { BUNDLE_MANIFEST_FILE_NAME, validateContentBundlePath } from "./contentBundlePath.js";

// 这三个上限必须和 yauzl import 同模块。纯模块里的 const 会被折叠成 134217728，
// 发布包保留的是 8*1024*1024 / 32*1024*1024 / 128*1024*1024。
export const BUNDLE_FILE_MAX_BYTES = 8 * 1024 * 1024;
export const BUNDLE_EXPANDED_MAX_BYTES = 32 * 1024 * 1024;
export const BUNDLE_CACHE_MAX_BYTES = 128 * 1024 * 1024;

export interface ContentBundleFileManifest {
  sha256: string;
  size: number;
}

export interface ContentBundleManifest {
  files: Record<string, ContentBundleFileManifest>;
  size: number;
}

const DIRECTORY_MODE = 0o040000;
const FILE_MODE = 0o100000;

function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function openZipFromBuffer(bytes: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zipFile) => {
        if (error || !zipFile) {
          reject(error ?? new Error("bundle_zip"));
          return;
        }
        resolve(zipFile);
      },
    );
  });
}

function openEntryStream(zipFile: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error("bundle_zip"));
        return;
      }
      resolve(stream);
    });
  });
}

export async function extractContentBundle(
  bytes: Buffer,
  destination: string,
): Promise<ContentBundleManifest> {
  const zipFile = await openZipFromBuffer(bytes);
  const manifest: ContentBundleManifest = {
    files: Object.create(null) as Record<string, ContentBundleFileManifest>,
    size: 0,
  };
  const seen = new Set<string>();
  let entries = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zipFile.on("error", reject);
      zipFile.on("end", resolve);
      zipFile.on("entry", (entry: Entry) => {
        void (async () => {
          if (++entries > 128 || (entry.generalPurposeBitFlag & 1) !== 0) {
            throw new Error("bundle_entry_limit");
          }
          const isDirectory = entry.fileName.endsWith("/");
          const relativePath = validateContentBundlePath(
            isDirectory ? entry.fileName.slice(0, -1) : entry.fileName,
          );
          const lowered = relativePath.toLowerCase();
          if (seen.has(lowered) || lowered === BUNDLE_MANIFEST_FILE_NAME) {
            throw new Error("bundle_duplicate_path");
          }
          seen.add(lowered);
          const fileType = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (fileType && fileType !== (isDirectory ? DIRECTORY_MODE : FILE_MODE)) {
            throw new Error("bundle_file_type");
          }
          if (
            entry.uncompressedSize > BUNDLE_FILE_MAX_BYTES ||
            manifest.size + entry.uncompressedSize > BUNDLE_EXPANDED_MAX_BYTES
          ) {
            throw new Error("bundle_expanded_size");
          }
          if (isDirectory) {
            await mkdir(join(destination, relativePath), { recursive: true });
          } else {
            const stream = await openEntryStream(zipFile, entry);
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array>) {
              const buffer = Buffer.from(chunk);
              size += buffer.length;
              if (
                size > BUNDLE_FILE_MAX_BYTES ||
                manifest.size + size > BUNDLE_EXPANDED_MAX_BYTES
              ) {
                throw new Error("bundle_expanded_size");
              }
              chunks.push(buffer);
            }
            const fileBytes = Buffer.concat(chunks);
            const parent = relativePath.includes("/")
              ? relativePath.slice(0, relativePath.lastIndexOf("/"))
              : "";
            await mkdir(join(destination, parent), { recursive: true });
            await writeFile(join(destination, relativePath), fileBytes, {
              flag: "wx",
              mode: 0o600,
            });
            manifest.files[relativePath] = { sha256: hashBytes(fileBytes), size };
            manifest.size += size;
          }
          zipFile.readEntry();
        })().catch(reject);
      });
      zipFile.readEntry();
    });
    return manifest;
  } finally {
    zipFile.close();
  }
}

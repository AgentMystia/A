import { readFile } from "node:fs/promises";
import type { NativeImage } from "electron";

const DEV_RIBBON_CENTER_RATIO = 0.24;
const DEV_RIBBON_HEIGHT_RATIO = 0.199;
const DEV_RIBBON_FONT_RATIO = 0.152;
const DEV_RIBBON_HALF_WIDTH_RATIO = 0.625;
const DEV_RIBBON_FILL = "#2563eb";

interface SharpPngEncoder {
  toBuffer(): Promise<Buffer>;
}

interface SharpPipeline {
  metadata(): Promise<{ width?: number; height?: number }>;
  composite(images: Array<{ input: Buffer; blend: "over" | "dest-in" }>): {
    png(): SharpPngEncoder;
  };
}

type SharpFactory = (input: Buffer) => SharpPipeline;

export interface DevBadgeLogger {
  warn(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

export interface RenderDevBadgeIconDeps {
  readFile?(path: string): Promise<Buffer>;
  importSharp?(): Promise<{ default: SharpFactory }>;
  createFromBuffer?(buffer: Buffer): NativeImage | Promise<NativeImage>;
  logger?: DevBadgeLogger;
}

// 唯一所有者。打包态保持 null，窗口继续用文件路径。
let installedDevBadgeIcon: NativeImage | null = null;

export function buildDevRibbonSvg(size: number): string {
  const center = Math.round(size * DEV_RIBBON_CENTER_RATIO);
  const ribbonHeight = Math.round(size * DEV_RIBBON_HEIGHT_RATIO);
  const fontSize = Math.round(size * DEV_RIBBON_FONT_RATIO);
  const ribbonHalfWidth = Math.round(size * DEV_RIBBON_HALF_WIDTH_RATIO);
  const letterSpacing = Math.max(2, Math.round(size * 0.008));
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <g transform="rotate(-45 ${center} ${center})">
    <rect x="${center - ribbonHalfWidth}" y="${center - ribbonHeight / 2}" width="${ribbonHalfWidth * 2}" height="${ribbonHeight}" fill="${DEV_RIBBON_FILL}"/>
    <text x="${center}" y="${center}" fill="#ffffff" font-family="-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="800" letter-spacing="${letterSpacing}" text-anchor="middle" dominant-baseline="central">DEV</text>
  </g>
</svg>`;
}

export async function renderDevBadgeIcon(
  iconPath: string,
  deps: RenderDevBadgeIconDeps = {},
): Promise<NativeImage | null> {
  const log = deps.logger;
  if (!log) {
    throw new Error("Dev badge logger is required.");
  }
  try {
    const loadSharp = deps.importSharp ?? (() => import("sharp"));
    const { default: sharp } = await loadSharp();
    const base = await (deps.readFile ?? readFile)(iconPath);
    const { width, height } = await sharp(base).metadata();
    if (!width || !height) {
      // sharp 读不到边长时发布包直接退回原图标，不猜测尺寸。
      log.warn("[dev-badge] base icon has no size metadata, fallback to default icon");
      return null;
    }
    const size = Math.min(width, height);
    const svg = Buffer.from(buildDevRibbonSvg(size));
    const overlaid = await sharp(base)
      .composite([{ input: svg, blend: "over" }])
      .png()
      .toBuffer();
    const masked = await sharp(overlaid)
      .composite([{ input: base, blend: "dest-in" }])
      .png()
      .toBuffer();
    if (!deps.createFromBuffer) {
      throw new Error("Dev badge createFromBuffer is required.");
    }
    const image = await deps.createFromBuffer(masked);
    if (image.isEmpty()) {
      log.warn("[dev-badge] rendered image is empty, fallback to default icon");
      return null;
    }
    const renderedSize = image.getSize();
    log.debug(`[dev-badge] icon rendered ${renderedSize.width}x${renderedSize.height}`);
    return image;
  } catch (error) {
    // 打包产物不含 sharp。动态 import 或解码失败都退回文件图标。
    log.warn("[dev-badge] render failed, fallback to default icon:", error);
    return null;
  }
}

export async function installDevBadgeIcon(
  iconPath: string,
  deps?: RenderDevBadgeIconDeps,
): Promise<void> {
  installedDevBadgeIcon = await renderDevBadgeIcon(iconPath, deps);
}

export function resolveAppIcon(fallbackPath: string): string | NativeImage {
  return installedDevBadgeIcon ?? fallbackPath;
}

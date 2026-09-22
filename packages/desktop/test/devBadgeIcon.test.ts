import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { NativeImage } from "electron";
import {
  buildDevRibbonSvg,
  installDevBadgeIcon,
  renderDevBadgeIcon,
  resolveAppIcon,
  type DevBadgeLogger,
  type RenderDevBadgeIconDeps,
} from "../src/main/devBadgeIcon.ts";

const silentLogger: DevBadgeLogger = {
  warn() {},
  debug() {},
};

beforeEach(async () => {
  await installDevBadgeIcon("unused", {
    importSharp: async () => {
      throw new Error("reset");
    },
    logger: silentLogger,
  });
});

describe("buildDevRibbonSvg", () => {
  it("draws the published 100px DEV ribbon", () => {
    assert.equal(
      buildDevRibbonSvg(100),
      `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
  <g transform="rotate(-45 24 24)">
    <rect x="-39" y="14" width="126" height="20" fill="#2563eb"/>
    <text x="24" y="24" fill="#ffffff" font-family="-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="15" font-weight="800" letter-spacing="2" text-anchor="middle" dominant-baseline="central">DEV</text>
  </g>
</svg>`,
    );
  });
});

describe("renderDevBadgeIcon", () => {
  it("composites the ribbon over the shorter edge and masks with the original file", async () => {
    const base = Buffer.from("base-png");
    const calls: Array<{ input: Buffer; blend?: string; overlay?: Buffer }> = [];
    const logs: unknown[][] = [];
    let rendered: Buffer | undefined;
    const image = {
      isEmpty: () => false,
      getSize: () => ({ width: 80, height: 80 }),
    };
    const result = await renderDevBadgeIcon("/icon.png", {
      logger: {
        warn(...args) {
          logs.push(args);
        },
        debug(...args) {
          logs.push(args);
        },
      },
      readFile: async () => base,
      importSharp: async () => ({
        default(input) {
          return {
            async metadata() {
              return { width: 100, height: 80 };
            },
            composite(ops) {
              const overlay = ops[0];
              calls.push({ input, blend: overlay?.blend, overlay: overlay?.input });
              return {
                png() {
                  return {
                    async toBuffer() {
                      return Buffer.from(`out-${overlay?.blend}`);
                    },
                  };
                },
              };
            },
          };
        },
      }),
      createFromBuffer(buffer) {
        rendered = buffer;
        return image as unknown as NativeImage;
      },
    });

    assert.equal(result, image);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.blend, "over");
    assert.equal(calls[0]?.input, base);
    assert.equal(calls[0]?.overlay?.toString(), buildDevRibbonSvg(80));
    assert.equal(calls[1]?.blend, "dest-in");
    assert.equal(calls[1]?.overlay, base);
    assert.equal(rendered?.toString(), "out-dest-in");
    assert.deepEqual(logs, [["[dev-badge] icon rendered 80x80"]]);
  });

  it("returns null when the base icon has no size", async () => {
    const logs: unknown[][] = [];
    const result = await renderDevBadgeIcon("/icon.png", {
      logger: {
        warn(...args) {
          logs.push(args);
        },
        debug() {},
      },
      readFile: async () => Buffer.from("base"),
      importSharp: async () => ({
        default() {
          return {
            async metadata() {
              return { width: 0, height: 32 };
            },
            composite() {
              throw new Error("composite should not run");
            },
          };
        },
      }),
    });
    assert.equal(result, null);
    assert.deepEqual(logs, [
      ["[dev-badge] base icon has no size metadata, fallback to default icon"],
    ]);
  });

  it("returns null when the rendered image is empty", async () => {
    const logs: unknown[][] = [];
    const result = await renderDevBadgeIcon("/icon.png", fakeSharpDeps(logs, { empty: true }));
    assert.equal(result, null);
    assert.deepEqual(logs, [["[dev-badge] rendered image is empty, fallback to default icon"]]);
  });

  it("returns null when sharp cannot be imported", async () => {
    const logs: unknown[][] = [];
    let read = false;
    const error = new Error("missing sharp");
    const result = await renderDevBadgeIcon("/icon.png", {
      logger: {
        warn(...args) {
          logs.push(args);
        },
        debug() {},
      },
      readFile: async () => {
        read = true;
        return Buffer.from("base");
      },
      importSharp: async () => {
        throw error;
      },
    });
    assert.equal(result, null);
    assert.equal(read, false);
    assert.deepEqual(logs, [["[dev-badge] render failed, fallback to default icon:", error]]);
  });
});

describe("resolveAppIcon", () => {
  it("returns the installed image and falls back to the path after a failed render", async () => {
    const image = {
      isEmpty: () => false,
      getSize: () => ({ width: 16, height: 16 }),
    };
    await installDevBadgeIcon("/icon.png", {
      ...fakeSharpDeps([], { empty: false, image }),
    });
    assert.equal(resolveAppIcon("/icon.png"), image);
    await installDevBadgeIcon("/icon.png", {
      importSharp: async () => {
        throw new Error("missing sharp");
      },
      logger: silentLogger,
    });
    assert.equal(resolveAppIcon("/icon.png"), "/icon.png");
  });
});

function fakeSharpDeps(
  logs: unknown[][],
  options: {
    empty: boolean;
    image?: { isEmpty(): boolean; getSize(): { width: number; height: number } };
  },
): RenderDevBadgeIconDeps {
  return {
    logger: {
      warn(...args) {
        logs.push(args);
      },
      debug(...args) {
        logs.push(args);
      },
    },
    readFile: async () => Buffer.from("base"),
    importSharp: async () => ({
      default() {
        return {
          async metadata() {
            return { width: 16, height: 16 };
          },
          composite() {
            return {
              png() {
                return {
                  async toBuffer() {
                    return Buffer.from("png");
                  },
                };
              },
            };
          },
        };
      },
    }),
    createFromBuffer() {
      const image = options.image ?? {
        isEmpty: () => options.empty,
        getSize: () => ({ width: 16, height: 16 }),
      };
      return image as unknown as NativeImage;
    },
  };
}

import { open } from "node:fs/promises";

const HEADER_BYTES = 4096;
const MH_MAGIC = 4277009102;
const MH_MAGIC_64 = 4277009103;
const FAT_MAGIC = 3405691582;
const FAT_MAGIC_64 = 3405691583;
const CPU_SUBTYPE_MASK = 4278190080;
const ARCH_NAMES = new Map([
  ["7:3", "i386"],
  ["16777223:3", "x86_64"],
  ["16777223:8", "x86_64h"],
  ["12:6", "armv6"],
  ["12:9", "armv7"],
  ["12:11", "armv7s"],
  ["12:12", "armv7k"],
  ["16777228:0", "arm64"],
  ["16777228:1", "arm64v8"],
  ["16777228:2", "arm64e"],
  ["33554444:1", "arm64_32"],
]);

export function archName(cpuType, cpuSubtype) {
  const subtype = (cpuSubtype & ~CPU_SUBTYPE_MASK) >>> 0;
  return (
    ARCH_NAMES.get(`${cpuType >>> 0}:${subtype}`) ||
    `unknown(0x${(cpuType >>> 0).toString(16).padStart(8, "0")},0x${subtype.toString(16).padStart(8, "0")})`
  );
}

export function parseMachoArchNames(header) {
  if (header.length < 8) throw new Error("not a Mach-O file: header shorter than 8 bytes");
  const magicBe = header.readUInt32BE(0);
  const magicLe = header.readUInt32LE(0);
  const bigEndianFat = magicBe === FAT_MAGIC || magicBe === FAT_MAGIC_64;
  if (bigEndianFat || magicLe === FAT_MAGIC || magicLe === FAT_MAGIC_64) {
    const magic = bigEndianFat ? magicBe : magicLe;
    const readU32 = (offset) =>
      bigEndianFat ? header.readUInt32BE(offset) : header.readUInt32LE(offset);
    const slices = readU32(4);
    const sliceSize = magic === FAT_MAGIC_64 ? 32 : 20;
    const bytesNeeded = 8 + slices * sliceSize;
    if (bytesNeeded > header.length) {
      throw new Error(
        `not a Mach-O file: fat header declares ${slices} slices (needs ${bytesNeeded} bytes, have ${header.length})`,
      );
    }
    const names = [];
    for (let index = 0; index < slices; index += 1) {
      const offset = 8 + index * sliceSize;
      names.push(archName(readU32(offset), readU32(offset + 4)));
    }
    return names;
  }
  const bigEndianThin = magicBe === MH_MAGIC || magicBe === MH_MAGIC_64;
  if (bigEndianThin || magicLe === MH_MAGIC || magicLe === MH_MAGIC_64) {
    if (header.length < 12) {
      throw new Error("not a Mach-O file: thin header truncated before cpusubtype");
    }
    const readU32 = (offset) =>
      bigEndianThin ? header.readUInt32BE(offset) : header.readUInt32LE(offset);
    return [archName(readU32(4), readU32(8))];
  }
  throw new Error(
    `not a Mach-O file: unrecognized magic 0x${magicBe.toString(16).padStart(8, "0")}`,
  );
}

export async function readMachoArchNames(executablePath) {
  const handle = await open(executablePath, "r");
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(header, 0, HEADER_BYTES, 0);
    return parseMachoArchNames(header.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

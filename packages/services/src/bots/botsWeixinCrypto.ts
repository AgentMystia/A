import { Buffer } from "node:buffer";
import { createDecipheriv } from "node:crypto";
import { WEIXIN_AES_ALGORITHM } from "./botsConstants.js";

/** 发布包 host `parseWeixinAesKey`：hex 32 或 base64 16 字节。 */
export function parseWeixinAesKey(value: string): Buffer | null {
  const trimmed = value.trim();
  if (/^[a-f0-9]{32}$/iu.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 16) {
      return decoded;
    }
    const nested = decoded.toString("utf8").trim();
    if (/^[a-f0-9]{32}$/iu.test(nested)) {
      return Buffer.from(nested, "hex");
    }
  } catch {
    return null;
  }
  return null;
}

export function decryptWeixinCdnMedia(bytes: Uint8Array, aesKey: string): Buffer {
  const key = parseWeixinAesKey(aesKey);
  if (!key) {
    throw new Error("Weixin attachment AES key is invalid.");
  }
  const decipher = createDecipheriv(WEIXIN_AES_ALGORITHM, key, null);
  return Buffer.concat([decipher.update(bytes), decipher.final()]);
}

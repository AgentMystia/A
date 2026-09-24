export const BUNDLE_MANIFEST_FILE_NAME = ".bundle.json";

const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export function validateContentBundlePath(value: string): string {
  if (
    !value ||
    value.length > 240 ||
    value === BUNDLE_MANIFEST_FILE_NAME ||
    /[\\:]/u.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error("bundle_path");
  }
  for (const part of value.split("/")) {
    if (
      !part ||
      part === "." ||
      part === ".." ||
      /[. ]$/u.test(part) ||
      WINDOWS_DEVICE_NAME.test(part)
    ) {
      throw new Error("bundle_path");
    }
  }
  return value;
}

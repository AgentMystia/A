/** 发布包 host big chunk。opencode 只在这里做运行时 model id，不进入 ZCodeProvider。 */
export function toAsciiSlug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "provider"
  );
}

export function hash8(value: string): string {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function toOpencodeProviderKey(providerId: string): string {
  const trimmed = providerId.trim();
  if (!trimmed) {
    throw new Error("providerId 不能为空");
  }
  return `${toAsciiSlug(trimmed)}-${hash8(trimmed)}`;
}

export function toOpencodeModelId(providerId: string, modelName: string): string {
  const trimmed = modelName.trim();
  if (!trimmed) {
    throw new Error("modelName 不能为空");
  }
  return `${toOpencodeProviderKey(providerId)}/${trimmed}`;
}

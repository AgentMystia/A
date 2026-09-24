export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readString(value: unknown, key: string): string {
  const field = isRecord(value) ? value[key] : undefined;
  return typeof field === "string" ? field : "";
}

export function readNumber(value: unknown, key: string): number | null {
  const field = isRecord(value) ? value[key] : undefined;
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

export function readNumberOrString(value: unknown, key: string): string {
  const field = isRecord(value) ? value[key] : undefined;
  if (typeof field === "string") {
    return field;
  }
  return typeof field === "number" && Number.isFinite(field) ? String(field) : "";
}

export function unwrapData(value: unknown): unknown {
  return isRecord(value) && "data" in value ? value.data : value;
}

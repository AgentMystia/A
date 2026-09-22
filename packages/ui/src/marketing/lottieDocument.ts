const LOTTIE_MAX_BYTES = 2 * 1024 * 1024;
const EXTERNAL_STRING_KEYS = new Set(["x", "p", "u", "fPath"]);

/** 发布包 lottie hero 拒绝外链、字体和表达式，避免活动动画再发请求。 */
export function validateLottieDocument(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("lottie_data");
  }
  const document = value as Record<string, unknown>;
  for (const dimension of [document.w, document.h]) {
    if (typeof dimension !== "number" || dimension <= 0 || dimension > 4096) {
      throw new Error("lottie_dimensions");
    }
  }
  const { fr, ip, op, layers } = document;
  if (
    typeof fr !== "number" ||
    fr <= 0 ||
    fr > 120 ||
    typeof ip !== "number" ||
    typeof op !== "number" ||
    !Number.isFinite(ip) ||
    !Number.isFinite(op) ||
    op <= ip ||
    op - ip > fr * 600 ||
    !Array.isArray(layers)
  ) {
    throw new Error("lottie_frames");
  }
  let nodes = 0;
  const visit = (node: unknown, depth: number) => {
    nodes += 1;
    if (nodes > 50_000 || depth > 40) {
      throw new Error("lottie_complexity");
    }
    if (!node || typeof node !== "object") {
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if ((EXTERNAL_STRING_KEYS.has(key) && typeof child === "string") || key === "fonts") {
        throw new Error("lottie_external_or_expression");
      }
      visit(child, depth + 1);
    }
  };
  visit(document, 0);
  return document;
}

export async function fetchLottieDocument(
  url: string,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal, credentials: "omit", redirect: "error" });
  if (!response.ok || !response.body) {
    throw new Error("lottie_fetch");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      size += next.value.byteLength;
      if (size > LOTTIE_MAX_BYTES) {
        throw new Error("lottie_size");
      }
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return validateLottieDocument(JSON.parse(new TextDecoder().decode(bytes)));
}

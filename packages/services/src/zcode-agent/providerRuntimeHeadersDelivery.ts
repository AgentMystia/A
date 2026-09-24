import type { AccountRequestAuthMaterial } from "#src/model-provider/accountRequestAuthService.js";
import type { ZCodeProviderAccountAccess } from "@zcode/shared";

const CAPTCHA_RUNTIME_HEADER_NAMES = [
  "X-Aliyun-Captcha-Verify-Param",
  "X-Aliyun-Captcha-Verify-Region",
] as const;

/**
 * 发布包只在账号服务存在、且 access 不是 Start Plan 时自动应答。
 * Start Plan 验证码、缺 access、缺服务都把请求留给 Renderer。
 * zcodeAgentService 在调用处内联同一判断，不要从那里再引用本函数。
 */
export function shouldDeferProviderRuntimeHeadersToRenderer(
  hasAccountRequestAuthService: boolean,
  accountAccess: Pick<ZCodeProviderAccountAccess, "mode"> | undefined,
): boolean {
  return !(
    hasAccountRequestAuthService &&
    accountAccess !== undefined &&
    accountAccess.mode !== "start-plan"
  );
}

/**
 * 只保留两枚阿里云验证码头。其它 runtime header 丢弃。
 * 空 apiKey 视为没有材料；没有任何头时返回 undefined。
 */
export function mergeCaptchaRuntimeProviderHeaders(
  material: AccountRequestAuthMaterial | undefined,
  runtimeProviderHeaders: Record<string, string> | undefined,
): AccountRequestAuthMaterial | undefined {
  const headers: Record<string, string> = { ...material?.headers };
  for (const [name, value] of Object.entries(runtimeProviderHeaders ?? {})) {
    const canonical = CAPTCHA_RUNTIME_HEADER_NAMES.find(
      (candidate) => candidate.toLowerCase() === name.trim().toLowerCase(),
    );
    const trimmed = value.trim();
    if (canonical && trimmed) {
      headers[canonical] = trimmed;
    }
  }
  const apiKey = material?.apiKey;
  if (!apiKey && Object.keys(headers).length === 0) {
    return undefined;
  }
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

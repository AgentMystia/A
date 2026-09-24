export const ALIYUN_CAPTCHA_SCRIPT_URL =
  "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
export const CAPTCHA_CONTAINER_ID = "zcode-aliyun-captcha-container";
export const CAPTCHA_ELEMENT_ID = "zcode-aliyun-captcha-element";
export const CAPTCHA_BUTTON_ID = "zcode-aliyun-captcha-button";
export const CAPTCHA_INSTANCE_WAIT_MS = 10_000;
export const CAPTCHA_PREWARM_DELAY_MS = 2_000;
export const CAPTCHA_TRACELESS_FALLBACK_MS = 8_000;
export const CAPTCHA_INTERACTIVE_TIMEOUT_MS = 120_000;
export const CAPTCHA_CONFIG_CACHE_MS = 60_000;
export const CAPTCHA_VERIFY_PARAM_HEADER = "X-Aliyun-Captcha-Verify-Param";
export const CAPTCHA_VERIFY_REGION_HEADER = "X-Aliyun-Captcha-Verify-Region";
export const CAPTCHA_VERIFICATION_FAILED = "Captcha verification failed. Please try again.";

export const CAPTCHA_LOCALE_PREFERENCE_KEY = "zcode-locale-preference";

export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const remove = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      remove();
      reject(signal.reason);
    };
    promise.then(
      (value) => {
        remove();
        resolve(value);
      },
      (error) => {
        remove();
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

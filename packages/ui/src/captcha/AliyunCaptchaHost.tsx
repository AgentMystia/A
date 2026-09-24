import { CAPTCHA_BUTTON_ID, CAPTCHA_CONTAINER_ID, CAPTCHA_ELEMENT_ID } from "./captchaDom.js";

/** 发布包把验证码宿主挂在 Root 外层，避免欢迎页和启动壳切换时卸掉 SDK 绑定的节点。 */
export function AliyunCaptchaHost() {
  return (
    <div
      id={CAPTCHA_CONTAINER_ID}
      aria-hidden="true"
      className="fixed left-0 top-0 z-[2147483647] h-0 w-0 overflow-visible"
    >
      <div id={CAPTCHA_ELEMENT_ID} className="absolute left-0 top-0 h-0 w-0 overflow-visible" />
      <button
        id={CAPTCHA_BUTTON_ID}
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="fixed left-1/2 top-1/2 h-px w-px -translate-x-1/2 -translate-y-1/2 border-0 p-0 opacity-0"
      />
    </div>
  );
}

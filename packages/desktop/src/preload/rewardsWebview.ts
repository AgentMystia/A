import { contextBridge } from "electron";
import { isTrustedRewardsUrl } from "@zcode/shared";

/**
 * 这段函数会被 Electron 原样送到奖励页主世界，不能引用模块外的绑定。
 * 发布包 `installRewardsPageBridge`：先清掉官网可能留下的登录键，再只接受合法上下文。
 */
function installRewardsPageBridge(): void {
  const storage = globalThis.localStorage;
  for (const key of ["oauth:zai:access_token", "oauth:bigmodel:access_token", "zcodejwttoken"]) {
    storage.removeItem(key);
  }
  const pageWindow = globalThis.window;
  let current: {
    theme: "zai-light" | "zai-dark";
    locale: "zh-CN" | "en-US";
    auth: {
      status: "ready" | "anonymous";
      provider: "zai" | "bigmodel" | null;
      revision: number;
    };
  } | null = null;
  const listeners = {
    theme: new Set<(value: "zai-light" | "zai-dark") => void>(),
    locale: new Set<(value: "zh-CN" | "en-US") => void>(),
    auth: new Set<
      (value: {
        status: "ready" | "anonymous";
        provider: "zai" | "bigmodel" | null;
        revision: number;
      }) => void
    >(),
  };
  pageWindow.addEventListener("zcode-rewards-context", (event) => {
    const detail = (event as CustomEvent).detail as
      | {
          theme?: unknown;
          locale?: unknown;
          auth?: {
            status?: unknown;
            provider?: unknown;
            revision?: unknown;
          };
        }
      | null
      | undefined;
    const theme = detail?.theme;
    const locale = detail?.locale;
    const auth = detail?.auth;
    const provider = auth?.provider;
    const status = auth?.status;
    const revision = auth?.revision;
    if (theme !== "zai-light" && theme !== "zai-dark") return;
    if (locale !== "zh-CN" && locale !== "en-US") return;
    if (status !== "ready" && status !== "anonymous") return;
    if (provider !== null && provider !== "zai" && provider !== "bigmodel") return;
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) return;
    const next: NonNullable<typeof current> = {
      theme: theme === "zai-dark" ? "zai-dark" : "zai-light",
      locale: locale === "zh-CN" ? "zh-CN" : "en-US",
      auth: {
        status: status === "ready" ? "ready" : "anonymous",
        provider: provider === "zai" ? "zai" : provider === "bigmodel" ? "bigmodel" : null,
        revision,
      },
    };
    const previous = current;
    current = next;
    if (JSON.stringify(previous?.theme) !== JSON.stringify(next.theme)) {
      for (const listener of listeners.theme) listener(next.theme);
    }
    if (JSON.stringify(previous?.locale) !== JSON.stringify(next.locale)) {
      for (const listener of listeners.locale) listener(next.locale);
    }
    if (JSON.stringify(previous?.auth) !== JSON.stringify(next.auth)) {
      for (const listener of listeners.auth) listener(next.auth);
    }
  });
  Object.defineProperty(pageWindow, "zcodeBridge", {
    configurable: false,
    writable: false,
    value: {
      getTheme() {
        return current?.theme ?? null;
      },
      getLang() {
        return current?.locale ?? null;
      },
      getAuthState() {
        return current?.auth ?? null;
      },
      onThemeChange(listener: (value: "zai-light" | "zai-dark") => void) {
        listeners.theme.add(listener);
        return () => listeners.theme.delete(listener);
      },
      onLangChange(listener: (value: "zh-CN" | "en-US") => void) {
        listeners.locale.add(listener);
        return () => listeners.locale.delete(listener);
      },
      onAuthChange(
        listener: (value: {
          status: "ready" | "anonymous";
          provider: "zai" | "bigmodel" | null;
          revision: number;
        }) => void,
      ) {
        listeners.auth.add(listener);
        return () => listeners.auth.delete(listener);
      },
    },
  });
}

// 不可信页不挂桥。dev 参数只由未打包主进程追加，打包态不能靠页面自己打开。
if (
  isTrustedRewardsUrl(window.location.href, {
    dev: process.argv.includes("--zcode-rewards-dev"),
    e2e: process.env.VITE_ZCODE_E2E_STORE_BRIDGE === "1",
  })
) {
  contextBridge.executeInMainWorld({ func: installRewardsPageBridge, args: [] });
}

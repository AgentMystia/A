import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  buildRewardsContextInjectionScript,
  buildRewardsWebviewUrl,
  isTrustedRewardsUrl,
  REWARDS_WEBVIEW_PARTITION,
  resolveRewardsWebviewOrigin,
  ZCODE_ENV,
  type RewardsWebviewContext,
  type RewardsWebviewTheme,
} from "@zcode/shared";
import { EmbeddedWebsiteHeader } from "@/components/EmbeddedWebsiteHeader.js";
import { Button } from "@/components/ui/button.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { resolveTheme, type Theme } from "@/useTheme.js";

const RewardsOpenContext = createContext<(() => void) | null>(null);

export function useRewardsOpen(): (() => void) | null {
  return useContext(RewardsOpenContext);
}

interface RewardsImportMetaEnv {
  DEV?: boolean;
  VITE_REWARDS_WEBVIEW_ORIGIN?: string;
  VITE_ZCODE_E2E_STORE_BRIDGE?: string;
}

function readRewardsImportMetaEnv(): RewardsImportMetaEnv {
  return ((import.meta as ImportMeta & { env?: RewardsImportMetaEnv }).env ??
    {}) as RewardsImportMetaEnv;
}

function rewardsTheme(theme: Theme, systemDark: boolean): RewardsWebviewTheme {
  if (theme === "system") return systemDark ? "zai-dark" : "zai-light";
  return resolveTheme(theme) === "dark" ? "zai-dark" : "zai-light";
}

function rewardsTrustOptions(env: RewardsImportMetaEnv) {
  return {
    dev: env.DEV === true,
    e2e: env.VITE_ZCODE_E2E_STORE_BRIDGE === "1",
  };
}

export function RewardsProvider({ children, desktop }: { children: ReactNode; desktop: boolean }) {
  const [open, setOpen] = useState(false);
  const platform = usePlatform();
  const { locale } = useZCodeIntl();
  const theme = useZCodeStore((state) => state.theme);
  const user = useZCodeStore((state) => state.user);
  const loginEntryAttempt = useZCodeStore((state) => state.loginEntryAttempt);
  const requestLoginEntry = useZCodeStore((state) => state.requestLoginEntry);
  const pendingLoginId = useRef<number | null>(null);
  const [systemDark, setSystemDark] = useState(() =>
    typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)").matches : false,
  );

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const openRewards = useCallback(async () => {
    if (!user) {
      if (pendingLoginId.current === null) {
        pendingLoginId.current = requestLoginEntry(undefined, "app-login");
      }
      return;
    }
    pendingLoginId.current = null;
    if (desktop) {
      setOpen(true);
      return;
    }
    const websiteTheme = resolveTheme(theme) === "dark" ? "zai-dark" : "zai-light";
    await platform.openExternal(
      buildRewardsWebviewUrl(
        resolveRewardsWebviewOrigin({ env: ZCODE_ENV }),
        locale === "zh-CN" ? "zh-CN" : "en-US",
        websiteTheme,
      ),
    );
  }, [desktop, locale, platform, requestLoginEntry, theme, user]);

  useEffect(() => {
    const requestId = pendingLoginId.current;
    if (requestId === null || !loginEntryAttempt) return;
    if (
      loginEntryAttempt.id !== requestId ||
      loginEntryAttempt.status === "cancelled" ||
      loginEntryAttempt.status === "failed"
    ) {
      pendingLoginId.current = null;
      return;
    }
    if (loginEntryAttempt.status === "succeeded" && user) {
      pendingLoginId.current = null;
      void openRewards().catch((error: unknown) => {
        logger.warn("[rewards] 登录后打开失败", { error });
      });
    }
  }, [loginEntryAttempt, openRewards, user]);

  return (
    <RewardsOpenContext.Provider value={() => void openRewards()}>
      {children}
      {open ? <RewardsSurface onClose={() => setOpen(false)} systemDark={systemDark} /> : null}
    </RewardsOpenContext.Provider>
  );
}

function RewardsSurface({ onClose, systemDark }: { onClose: () => void; systemDark: boolean }) {
  const services = useOptionalServices();
  const platform = usePlatform();
  const { intl, locale } = useZCodeIntl();
  const theme = useZCodeStore((state) => state.theme);
  const userId = useZCodeStore((state) => state.user?.id ?? null);
  const env = readRewardsImportMetaEnv();
  const trust = rewardsTrustOptions(env);
  const pageTheme = rewardsTheme(theme, systemDark);
  const pageLocale: "zh-CN" | "en-US" = locale === "zh-CN" ? "zh-CN" : "en-US";
  const [pageUrl] = useState(() =>
    buildRewardsWebviewUrl(
      resolveRewardsWebviewOrigin({
        ...trust,
        env: ZCODE_ENV,
        override:
          typeof env.VITE_REWARDS_WEBVIEW_ORIGIN === "string"
            ? env.VITE_REWARDS_WEBVIEW_ORIGIN
            : undefined,
      }),
      pageLocale,
      pageTheme,
    ),
  );
  const webviewRef = useRef<ElectronWebviewTag | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const generationRef = useRef(0);
  const domReadyRef = useRef(false);
  const injectedUserIdRef = useRef<string | null | undefined>(undefined);
  const authRevisionRef = useRef({ fingerprint: "", revision: 0 });
  const latestRef = useRef({ theme: pageTheme, locale: pageLocale, userId });
  latestRef.current = { theme: pageTheme, locale: pageLocale, userId };
  const [loadFailed, setLoadFailed] = useState(false);
  const [navigation, setNavigation] = useState({ loading: true, back: false, forward: false });

  const injectContext = useCallback(async () => {
    const webview = webviewRef.current;
    if (!webview || !domReadyRef.current) return;
    const generation = ++generationRef.current;
    const activeUserId = latestRef.current.userId;
    try {
      const currentUrl = webview.getURL();
      if (!isTrustedRewardsUrl(currentUrl, trust)) return;
      if (injectedUserIdRef.current !== activeUserId) {
        await webview.executeJavaScript(
          buildRewardsContextInjectionScript(
            anonymousContext(latestRef.current, ++authRevisionRef.current.revision),
            {},
            currentUrl,
          ),
        );
        injectedUserIdRef.current = activeUserId;
      }
      const activeProvider = activeUserId ? await services?.oauthService.getActiveProvider() : null;
      const provider =
        activeProvider === "zai" ? "zai" : activeProvider === "bigmodel" ? "bigmodel" : null;
      const [oauth, jwt] = provider
        ? await Promise.all([
            services?.credentialService.load(`oauth:${provider}:access_token`) ?? null,
            services?.credentialService.load("zcodejwttoken") ?? null,
          ])
        : [null, null];
      if (
        webviewRef.current !== webview ||
        generation !== generationRef.current ||
        latestRef.current.userId !== activeUserId ||
        !domReadyRef.current ||
        webview.getURL() !== currentUrl
      ) {
        return;
      }
      const fingerprint = JSON.stringify([activeUserId, provider, oauth, jwt]);
      if (authRevisionRef.current.fingerprint !== fingerprint) {
        authRevisionRef.current.fingerprint = fingerprint;
        authRevisionRef.current.revision += 1;
      }
      const context: RewardsWebviewContext = {
        theme: latestRef.current.theme,
        locale: latestRef.current.locale,
        auth: {
          provider,
          status: activeUserId && (oauth || jwt) ? "ready" : "anonymous",
          revision: authRevisionRef.current.revision,
        },
      };
      await webview.executeJavaScript(
        buildRewardsContextInjectionScript(context, { oauth, jwt }, currentUrl),
      );
      if (generation === generationRef.current) setLoadFailed(false);
    } catch {
      if (generation === generationRef.current) {
        setLoadFailed(true);
        logger.warn("[rewards] context injection failed");
      }
    }
  }, [services, trust.dev, trust.e2e]);

  const injectContextRef = useRef(injectContext);
  injectContextRef.current = injectContext;

  useEffect(() => {
    void injectContext();
  }, [injectContext, pageLocale, pageTheme, userId]);

  const handleWebviewRef = useCallback((webview: ElectronWebviewTag | null) => {
    detachRef.current?.();
    webviewRef.current = webview;
    if (!webview) return;
    const syncNavigation = () =>
      setNavigation((state) => ({
        ...state,
        back: webview.canGoBack(),
        forward: webview.canGoForward(),
      }));
    const handleStart = () => {
      generationRef.current += 1;
      domReadyRef.current = false;
      setNavigation((state) => ({ ...state, loading: true }));
    };
    const handleStop = () => {
      syncNavigation();
      setNavigation((state) => ({ ...state, loading: false }));
      domReadyRef.current = true;
      void injectContextRef.current();
    };
    const handleReady = () => {
      domReadyRef.current = true;
      syncNavigation();
      void injectContextRef.current();
    };
    const handleFail = (event: ElectronWebviewDidFailLoadEvent) => {
      if (event.isMainFrame && event.errorCode !== -3) {
        setLoadFailed(true);
        logger.warn("[rewards] webview load failed", { code: event.errorCode });
      }
    };
    webview.addEventListener("dom-ready", handleReady);
    webview.addEventListener("did-start-loading", handleStart);
    webview.addEventListener("did-stop-loading", handleStop);
    webview.addEventListener("did-fail-load", handleFail);
    detachRef.current = () => {
      generationRef.current += 1;
      if (domReadyRef.current) {
        try {
          void webview
            .executeJavaScript(
              buildRewardsContextInjectionScript(
                anonymousContext(latestRef.current, ++authRevisionRef.current.revision),
                {},
                webview.getURL(),
              ),
            )
            .catch(() => undefined);
        } catch {
          // webview 已经销毁时清凭据失败可以忽略。
        }
      }
      domReadyRef.current = false;
      webview.removeEventListener("dom-ready", handleReady);
      webview.removeEventListener("did-start-loading", handleStart);
      webview.removeEventListener("did-stop-loading", handleStop);
      webview.removeEventListener("did-fail-load", handleFail);
    };
  }, []);

  useEffect(
    () => () => {
      detachRef.current?.();
      webviewRef.current = null;
    },
    [],
  );

  const closeSurface = async () => {
    generationRef.current += 1;
    const webview = webviewRef.current;
    try {
      if (webview && domReadyRef.current) {
        await webview.executeJavaScript(
          buildRewardsContextInjectionScript(
            anonymousContext(
              { theme: pageTheme, locale: pageLocale, userId },
              generationRef.current,
            ),
            {},
            webview.getURL(),
          ),
        );
      }
    } catch {
      // 关闭时清凭据失败不阻止面板收起。
    }
    onClose();
  };

  return (
    <section
      data-testid="rewards-surface"
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background pt-12 text-foreground"
    >
      <EmbeddedWebsiteHeader
        title={intl.formatMessage({ id: "rewards.title" })}
        loading={navigation.loading}
        canGoBack={navigation.back}
        canGoForward={navigation.forward}
        onBack={() => webviewRef.current?.goBack()}
        onForward={() => webviewRef.current?.goForward()}
        onReload={() => webviewRef.current?.reload()}
        onClose={() => void closeSurface()}
      />
      {loadFailed ? (
        <div
          role="alert"
          className="mx-auto flex w-full max-w-5xl items-center gap-3 px-6 text-ui-base"
        >
          <span>{intl.formatMessage({ id: "rewards.loadFailed" })}</span>
          <Button
            variant="ghost"
            onClick={() => {
              setLoadFailed(false);
              webviewRef.current?.reload();
            }}
          >
            {intl.formatMessage({ id: "common.refresh" })}
          </Button>
          <Button variant="ghost" onClick={() => void platform.openExternal(pageUrl)}>
            {intl.formatMessage({ id: "rewards.openWebsite" })}
          </Button>
        </div>
      ) : null}
      <webview
        ref={handleWebviewRef}
        src={pageUrl}
        partition={REWARDS_WEBVIEW_PARTITION}
        className="min-h-0 w-full flex-1 bg-background"
        data-testid="rewards-webview"
      />
    </section>
  );
}

function anonymousContext(
  current: { theme: RewardsWebviewTheme; locale: "zh-CN" | "en-US"; userId: string | null },
  revision: number,
): RewardsWebviewContext {
  return {
    theme: current.theme,
    locale: current.locale,
    auth: { status: "anonymous", provider: null, revision },
  };
}

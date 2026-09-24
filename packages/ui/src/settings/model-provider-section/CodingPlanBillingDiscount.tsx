import { InfoIcon, TrendingUpIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { cn } from "@/components/lib/utils.js";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import { logger } from "@/logger.js";
import { useZCodeStoreWithDefault } from "@/store/StoreProvider.js";
import {
  isCodingPlanBillingDiscountCopyComplete,
  loadCodingPlanBillingDiscount,
  readCodingPlanBillingDiscountCache,
  readCodingPlanBillingDiscountCopy,
} from "./codingPlanBillingDiscountCache.js";

const DIALOG_CLASS =
  "max-h-[min(82vh,640px)] max-w-lg grid-rows-[auto_minmax(0,1fr)] overflow-hidden";
const DIALOG_BODY_CLASS = "p-3 !space-y-3";

type BillingDiscountSize = "default" | "compact";
type BillingDiscountVariant = "gradient" | "surface" | "tag";

interface BillingDiscountState {
  active: boolean;
  config: unknown;
  loading: boolean;
}

export function useCodingPlanBillingDiscount() {
  const services = useOptionalServices();
  const service = services?.codingPlanSubscriptionService;
  const { locale } = useZCodeIntl();
  const cached = readCodingPlanBillingDiscountCache();
  const [state, setState] = useState<BillingDiscountState>({
    active: isCodingPlanBillingDiscountCopyComplete(cached?.value, locale, ["badgeBody"]),
    config: cached?.value,
    loading: Boolean(service) && !cached,
  });

  const refresh = useCallback(async () => {
    if (!service || typeof service.getBillingDiscount !== "function") {
      setState({ active: false, config: undefined, loading: false });
      return;
    }
    setState((current) => ({ ...current, loading: true }));
    try {
      const config = await loadCodingPlanBillingDiscount(service);
      setState({
        active: isCodingPlanBillingDiscountCopyComplete(config, locale, ["badgeBody"]),
        config,
        loading: false,
      });
    } catch (error) {
      // 活动配置失败只收起徽标，不能挡住升级按钮本身。
      logger.warn("[CodingPlanBillingDiscount] 读取 Coding Plan 活动配置失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      setState({ active: false, config: undefined, loading: false });
    }
  }, [locale, service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}

export function CodingPlanBillingDiscountBadge({
  config,
  iconVisible = true,
  size = "default",
  variant = "gradient",
}: {
  config: unknown;
  iconVisible?: boolean;
  size?: BillingDiscountSize;
  variant?: BillingDiscountVariant;
}) {
  const { locale } = useZCodeIntl();
  const copy = readCodingPlanBillingDiscountCopy(config, locale);
  if (!copy.badgeBody) return null;
  return (
    <div
      className={cn(
        "inline-flex items-center py-0.5 whitespace-nowrap",
        size === "compact" ? "gap-0.5 px-1.5 text-ui-xs leading-none" : "gap-1 px-2 text-ui-xs",
        variant === "surface"
          ? "rounded-full bg-white text-[#191A1D]"
          : variant === "tag"
            ? "rounded-full bg-tag text-foreground"
            : "rounded-full text-white button-gradient dark:bg-[#484A58]",
      )}
    >
      {iconVisible ? (
        <TrendingUpIcon className={size === "compact" ? "size-2.5" : "size-3"} />
      ) : null}
      {copy.badgeBody}
    </div>
  );
}

export function CodingPlanBillingDiscountBadgeWithInfo({
  config,
  iconVisible = true,
  size = "default",
  variant = "gradient",
}: {
  config: unknown;
  iconVisible?: boolean;
  size?: BillingDiscountSize;
  variant?: BillingDiscountVariant;
}) {
  const { locale } = useZCodeIntl();
  if (!readCodingPlanBillingDiscountCopy(config, locale).badgeBody) return null;
  return (
    <>
      <CodingPlanBillingDiscountBadge
        config={config}
        iconVisible={iconVisible}
        size={size}
        variant={variant}
      />
      <CodingPlanBillingDiscountInfo
        config={config}
        tone={variant === "surface" ? "onGradient" : "default"}
      />
    </>
  );
}

export function CodingPlanBillingDiscountInfo({
  config,
  tone = "default",
}: {
  config: unknown;
  tone?: "default" | "onGradient";
}) {
  const { intl, locale } = useZCodeIntl();
  const theme = useZCodeStoreWithDefault((state) => state.theme, "system");
  const codePreviewSettings = useZCodeStoreWithDefault(
    (state) => state.codePreviewSettings,
    DEFAULT_CODE_PREVIEW_SETTINGS,
  );
  const copy = readCodingPlanBillingDiscountCopy(config, locale);
  if (!copy.infoTitle || !copy.infoBody) return null;
  const markdown = `## ${copy.infoTitle}\n\n${copy.infoBody}`;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <InfoIcon
          role="button"
          tabIndex={0}
          aria-label={intl.formatMessage({
            id: "settings.modelProvider.codingPlan.billingDiscountInfo.open",
          })}
          className={cn(
            "size-3.5 shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            tone === "onGradient"
              ? "text-white/90 hover:text-white"
              : "text-foreground-subtle hover:text-foreground",
          )}
        />
      </DialogTrigger>
      <DialogContent className={cn(DIALOG_CLASS, "block")}>
        <div className={DIALOG_BODY_CLASS}>
          <MessageResponse
            className="min-h-0 overflow-y-auto pr-1 text-foreground"
            theme={theme}
            codePreviewSettings={codePreviewSettings}
          >
            {markdown}
          </MessageResponse>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { isCodingPlanModelProviderId, type MarketingDelivery } from "@zcode/shared";

import { readMarketingPlainLabel } from "./marketingPlainLabel.js";

export const CLOUD_HERO_CHANNEL = "zcode-cloud-hero-v1";

export interface CloudDialogRichText {
  format: "plain_text" | "html" | "markdown";
  text: string;
}

export interface CloudDialogImageHero {
  type: "image";
  src: string;
  darkSrc?: string;
  alt: string;
  fit?: "contain" | "cover";
}

export interface CloudDialogVideoHero {
  type: "video";
  src: string;
  darkSrc?: string;
  poster?: string;
  fit?: "contain" | "cover";
  loop?: boolean;
  autoplay?: boolean;
  muted?: boolean;
}

export interface CloudDialogLottieHero {
  type: "lottie";
  src: string;
  darkSrc?: string;
  loop?: boolean;
  speed?: number;
  autoplay?: boolean;
  fallback?: CloudDialogImageHero;
}

export interface CloudDialogInteractiveHero {
  type: "interactive_bundle";
  resolvedUrl?: string;
  runtime?: string;
  data?: Record<string, unknown>;
  events: Record<string, string>;
  fallback?: CloudDialogImageHero;
}

export type CloudDialogHero =
  | CloudDialogImageHero
  | CloudDialogVideoHero
  | CloudDialogLottieHero
  | CloudDialogInteractiveHero;

export type CloudDialogAction =
  | { type: "close" }
  | { type: "copy_text"; text: string }
  | { type: "navigate"; destination: "plugin_store" | "settings" }
  | { type: "open_external"; url: string }
  | { type: "claim_plan"; planId: string }
  | { type: "dismiss_content" };

export interface CloudDialogButton {
  id: string;
  actionId: string;
  label: string;
  formattedLabel: CloudDialogRichText;
  variant: "primary" | "secondary";
  theme: {
    variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "warning" | "link";
    class?: string;
    style?: string;
  };
}

export interface CloudDialogPayload {
  schemaVersion: 1;
  id: string;
  revision: number;
  kind: "campaign";
  locale: string;
  dialog: {
    title: string;
    formattedTitle: CloudDialogRichText;
    description: CloudDialogRichText;
    hero: CloudDialogHero | null;
    buttons: CloudDialogButton[];
  };
  actions: Record<string, CloudDialogAction>;
}

type MarketingPopup = Extract<MarketingDelivery, { resource_position: "popup" }>["popup"];

function toRichText(value: {
  format: "plaintext" | "html" | "markdown";
  content: string;
}): CloudDialogRichText {
  return {
    format: value.format === "plaintext" ? "plain_text" : value.format,
    text: value.content,
  };
}

export function buildCloudDialogPayload(input: {
  campaignId: string;
  locale: string;
  popup: MarketingPopup;
  hero: CloudDialogHero | null;
  modelSettingsLabel?: string;
}): CloudDialogPayload {
  const actions: Record<string, CloudDialogAction> = {};
  const buttons = input.popup.buttons.map((button, index) => {
    const actionId = `button-${index}`;
    const action = button.action;
    const modelSettingsLabel =
      input.modelSettingsLabel &&
      action.type === "navigate" &&
      action.args.page === "settings" &&
      action.args.section === "models" &&
      isCodingPlanModelProviderId(action.args.provider_id ?? "")
        ? input.modelSettingsLabel
        : undefined;
    actions[actionId] =
      action.type === "close"
        ? { type: "close" }
        : action.type === "open_url"
          ? { type: "open_external", url: action.args.url }
          : action.type === "copy_text"
            ? { type: "copy_text", text: action.args.text }
            : action.type === "navigate"
              ? {
                  type: "navigate",
                  destination:
                    action.args.page === "plugin_marketplace" ? "plugin_store" : "settings",
                }
              : { type: "claim_plan", planId: action.args.plan_id };
    const formatted = toRichText(button.text);
    return {
      id: actionId,
      actionId,
      label: modelSettingsLabel ?? readMarketingPlainLabel(button.text),
      formattedLabel: {
        format:
          modelSettingsLabel || button.text.format === "plaintext"
            ? "plain_text"
            : formatted.format,
        text: modelSettingsLabel ?? button.text.content,
      },
      variant: action.type === "close" ? "secondary" : "primary",
      theme: {
        variant: button.theme?.variant ?? "default",
        class: button.theme?.class,
        style: button.theme?.style,
      },
    } satisfies CloudDialogButton;
  });
  return {
    schemaVersion: 1,
    id: input.campaignId,
    revision: 1,
    kind: "campaign",
    locale: input.locale,
    dialog: {
      title: readMarketingPlainLabel(input.popup.title),
      formattedTitle: toRichText(input.popup.title),
      description: toRichText(input.popup.description),
      hero: input.hero,
      buttons,
    },
    actions,
  };
}

export function projectMarketingHeroData(
  args: Record<string, unknown> | undefined,
  locale: string,
): Record<string, unknown> {
  const plan = args?.zcode_plan;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return args ?? {};
  }
  const record = plan as Record<string, unknown>;
  const entitlements = Array.isArray(record.entitlements) ? record.entitlements : [];
  const benefits: string[] = [];
  let amount = 0;
  for (const item of entitlements.slice(0, 32)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const entitlement = item as Record<string, unknown>;
    if (entitlement.meter !== "model_usage") {
      continue;
    }
    const units =
      typeof entitlement.grant_units === "number" && Number.isFinite(entitlement.grant_units)
        ? entitlement.grant_units
        : 0;
    amount = Math.max(amount, units);
    if (typeof entitlement.show_name === "string") {
      const unit = typeof entitlement.unit_type === "string" ? entitlement.unit_type : "";
      benefits.push(
        `${entitlement.show_name} · ${new Intl.NumberFormat(locale).format(units)} ${unit}`,
      );
    }
  }
  return {
    ...args,
    planName: typeof record.name === "string" ? record.name : "",
    amountValue: new Intl.NumberFormat(locale).format(amount),
    amountUnit: "tokens",
    benefits,
    endsAtLabel:
      typeof record.ends_at === "number"
        ? new Date(record.ends_at * 1000).toLocaleString(locale)
        : "",
    endsAtPrefix: locale === "zh-CN" ? "有效期至" : "Valid until",
    replayLabel: locale === "zh-CN" ? "重播" : "Replay",
  };
}

export type CloudHeroInboundMessage =
  | { channel: typeof CLOUD_HERO_CHANNEL; type: "ready"; instanceId: string }
  | { channel: typeof CLOUD_HERO_CHANNEL; type: "action"; instanceId: string; id: string }
  | { channel: typeof CLOUD_HERO_CHANNEL; type: "resize"; instanceId: string; height: number }
  | { channel: typeof CLOUD_HERO_CHANNEL; type: "error"; instanceId: string; code: string };

export function readCloudHeroInboundMessage(value: unknown): CloudHeroInboundMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const message = value as Record<string, unknown>;
  if (message.channel !== CLOUD_HERO_CHANNEL || typeof message.instanceId !== "string") {
    return null;
  }
  const instanceId = message.instanceId;
  switch (message.type) {
    case "ready":
      return { channel: CLOUD_HERO_CHANNEL, type: "ready", instanceId };
    case "action":
      return typeof message.id === "string"
        ? { channel: CLOUD_HERO_CHANNEL, type: "action", instanceId, id: message.id }
        : null;
    case "resize":
      return typeof message.height === "number" && Number.isFinite(message.height)
        ? { channel: CLOUD_HERO_CHANNEL, type: "resize", instanceId, height: message.height }
        : null;
    case "error":
      return typeof message.code === "string"
        ? { channel: CLOUD_HERO_CHANNEL, type: "error", instanceId, code: message.code }
        : null;
    default:
      return null;
  }
}

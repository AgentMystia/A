import { z } from "zod";
import { cloudDialogButtonThemeSchema } from "./cloudDialogPayload.js";

const campaignIdSchema = z.string().trim().min(1).max(128);
const assetUrlSchema = z
  .string()
  .max(4096)
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) {
      return false;
    }
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  });

export const marketingAssetRefSchema = z.object({
  src: assetUrlSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

export type MarketingAssetRef = z.infer<typeof marketingAssetRefSchema>;

const richTextSchema = z.object({
  format: z.enum(["plaintext", "html", "markdown"]),
  content: z.string().max(20_000),
});

const navigateTargetSchema = z.discriminatedUnion("page", [
  z.object({ page: z.literal("upgrade") }).strict(),
  z.object({ page: z.literal("rewards") }).strict(),
  z
    .object({
      page: z.literal("settings"),
      section: z
        .enum([
          "general",
          "appearance",
          "models",
          "browser",
          "computer_use",
          "memory",
          "subagents",
          "plugins",
          "mcp",
          "skills",
          "commands",
          "hooks",
          "usage",
        ])
        .optional(),
      provider_id: campaignIdSchema.optional(),
    })
    .strict()
    .refine((value) => value.provider_id === undefined || value.section === "models"),
  z
    .object({
      page: z.literal("plugin_marketplace"),
      plugin_id: campaignIdSchema.regex(/^[^@\s]+@[^@\s]+$/u).optional(),
    })
    .strict(),
]);

const buttonActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("close") }),
  z.object({ type: z.literal("open_url"), args: z.object({ url: assetUrlSchema }) }),
  z.object({ type: z.literal("claim_zcode_plan"), args: z.object({ plan_id: campaignIdSchema }) }),
  z.object({ type: z.literal("navigate"), args: navigateTargetSchema }),
  z.object({
    type: z.literal("copy_text"),
    args: z
      .object({
        text: z
          .string()
          .max(20_000)
          .refine((value) => value.trim().length > 0),
      })
      .strict(),
  }),
]);

const popupButtonSchema = z.object({
  text: richTextSchema,
  action: buttonActionSchema,
  theme: cloudDialogButtonThemeSchema.nullish(),
});

const bannerButtonSchema = popupButtonSchema.omit({ theme: true }).extend({
  text: richTextSchema.extend({
    format: z
      .enum(["", "plaintext", "html", "markdown"])
      .transform((value) => value || "plaintext"),
  }),
});

const layoutSchema = z.enum(["", "v1"]).optional();
const visualArgsSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 64_000)
  .optional();

const visualSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("image"),
    image: z.object({
      default: marketingAssetRefSchema,
      dark: marketingAssetRefSchema.nullish(),
    }),
    args: visualArgsSchema,
  }),
  z.object({
    type: z.literal("video"),
    video: z.object({
      src: marketingAssetRefSchema,
      fallback: marketingAssetRefSchema,
    }),
    args: visualArgsSchema,
  }),
  z.object({
    type: z.literal("bundle"),
    bundle: z.object({
      bundle: marketingAssetRefSchema,
      entry: z
        .string()
        .min(1)
        .max(240)
        .refine(
          (value) =>
            !value.includes("\\") &&
            value.split("/").every((part) => part && part !== "." && part !== ".."),
        ),
      fallback: marketingAssetRefSchema.nullish(),
    }),
    args: visualArgsSchema,
  }),
]);

const popupSchema = z.object({
  layout: layoutSchema,
  title: richTextSchema,
  description: richTextSchema,
  hero: visualSchema.nullish(),
  buttons: z.array(popupButtonSchema).max(4),
});

const bannerSchema = z
  .object({
    layout: layoutSchema,
    background: visualSchema,
    buttons: z.array(bannerButtonSchema).max(2),
    success_popup: popupSchema.nullish(),
  })
  .refine(
    (value) =>
      value.buttons.filter((button) => button.action.type === "close").length <= 1 &&
      value.buttons.filter((button) => button.action.type !== "close").length <= 1,
  );

const deliveryBase = {
  campaign_id: campaignIdSchema,
  priority: z.number().int().min(0).max(100),
};

export const marketingDeliverySchema = z.discriminatedUnion("resource_position", [
  z.object({
    ...deliveryBase,
    resource_position: z.literal("banner"),
    banner: bannerSchema,
  }),
  z.object({
    ...deliveryBase,
    resource_position: z.literal("popup"),
    popup: popupSchema,
  }),
]);

export type MarketingDelivery = z.infer<typeof marketingDeliverySchema>;

export const marketingTouchEnvelopeSchema = z.object({
  code: z.literal(0),
  data: z.object({
    server_time: z.number().finite(),
    language: z.enum(["zh-CN", "en-US"]),
    deliveries: z.array(z.unknown()).max(32),
  }),
});

export const marketingTouchLocaleSchema = z.enum(["zh-CN", "en-US"]);
export type MarketingTouchLocale = z.infer<typeof marketingTouchLocaleSchema>;

export const marketingTouchActionSchema = z.object({
  locale: marketingTouchLocaleSchema,
  scope: z.string().uuid(),
  campaignId: z.string().trim().min(1).max(128),
  actionType: z.enum(["confirm", "cancel"]),
});

export type MarketingTouchAction = z.infer<typeof marketingTouchActionSchema>;

export interface MarketingTouchSnapshot {
  serverTime: number;
  language: MarketingTouchLocale;
  deliveries: MarketingDelivery[];
  rejectedCount: number;
}

export interface MarketingTouchQueryResult extends MarketingTouchSnapshot {
  scope: string;
}

export function parseMarketingTouchResponse(payload: unknown): MarketingTouchSnapshot {
  const { data } = marketingTouchEnvelopeSchema.parse(payload);
  const deliveries: MarketingDelivery[] = [];
  let rejectedCount = 0;
  const seen = new Set<string>();
  for (const item of data.deliveries) {
    const parsed = marketingDeliverySchema.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.resource_position)) {
      rejectedCount += 1;
      continue;
    }
    seen.add(parsed.data.resource_position);
    deliveries.push(parsed.data);
  }
  return {
    serverTime: data.server_time * 1000,
    language: data.language,
    deliveries,
    rejectedCount,
  };
}

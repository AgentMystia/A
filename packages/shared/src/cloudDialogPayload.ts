import { z } from "zod";

/**
 * 发布包把这份云弹窗 payload zod 打进 renderer、main、host、preload 和 scheduler。
 * 不拿它解析运行时 hero：投影后的地址可以是本地媒体，不是 http(s)。
 */
const cloudDialogButtonThemeSchema = z.object({
  variant: z
    .enum(["", "default", "outline", "secondary", "ghost", "destructive", "warning", "link"])
    .optional()
    .transform((value) => value || "default"),
  class: z.string().max(512).optional(),
  style: z.string().max(512).optional(),
});

const cloudDialogAssetUrlSchema = z
  .string()
  .max(4096)
  .url()
  .refine(
    (value) =>
      URL.canParse(value) &&
      /^https?:\/\//iu.test(value) &&
      !new URL(value).username &&
      !new URL(value).password,
  );

const cloudDialogIdSchema = z.string().min(1).max(128);

const cloudDialogImageHeroSchema = z.object({
  type: z.literal("image"),
  src: cloudDialogAssetUrlSchema,
  darkSrc: cloudDialogAssetUrlSchema.optional(),
  alt: z.string().max(500),
  fit: z.enum(["cover", "contain"]).optional(),
});

const cloudDialogBundleSchema = z.object({
  format: z.literal("zip"),
  url: cloudDialogAssetUrlSchema,
  entry: z.string().min(1).max(240),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(8 * 1024 * 1024)
    .optional(),
});

const cloudDialogHeroSchema = z.discriminatedUnion("type", [
  cloudDialogImageHeroSchema,
  z.object({
    type: z.literal("video"),
    src: cloudDialogAssetUrlSchema,
    darkSrc: cloudDialogAssetUrlSchema.optional(),
    poster: cloudDialogAssetUrlSchema,
    autoplay: z.boolean().optional(),
    loop: z.boolean().optional(),
    muted: z.literal(true),
    fit: z.enum(["cover", "contain"]).optional(),
  }),
  z.object({
    type: z.literal("lottie"),
    src: cloudDialogAssetUrlSchema,
    darkSrc: cloudDialogAssetUrlSchema.optional(),
    autoplay: z.boolean().optional(),
    loop: z.boolean().optional(),
    speed: z.number().min(0.1).max(4).optional(),
    fallback: cloudDialogImageHeroSchema.optional(),
  }),
  z.object({
    type: z.literal("interactive_bundle"),
    runtime: z.literal("zcode-hero-sandbox-v1"),
    bundle: cloudDialogBundleSchema,
    viewport: z.object({ aspectRatio: z.literal("4:3") }),
    data: z
      .record(z.string(), z.unknown())
      .refine((value) => JSON.stringify(value).length <= 64_000),
    events: z
      .record(cloudDialogIdSchema, cloudDialogIdSchema)
      .refine((value) => Object.keys(value).length <= 16),
    fallback: cloudDialogImageHeroSchema.optional(),
  }),
]);

const cloudDialogActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("close") }),
  z.object({ type: z.literal("dismiss_content") }),
  z.object({
    type: z.literal("navigate"),
    destination: z.enum(["model_settings", "plugin_store", "settings"]),
  }),
  z.object({ type: z.literal("copy_text"), text: z.string().max(20_000) }),
  z.object({ type: z.literal("open_external"), url: cloudDialogAssetUrlSchema }),
  z.object({ type: z.literal("claim_plan"), planId: cloudDialogIdSchema }),
]);

export const cloudDialogPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: cloudDialogIdSchema,
    revision: z.number().int().positive(),
    kind: z.enum(["campaign", "feature", "notice"]),
    locale: z.enum(["zh-CN", "en-US"]),
    dialog: z.object({
      title: z.string().min(1).max(500),
      description: z.object({
        format: z.enum(["plain_text", "html", "markdown"]),
        text: z.string().max(20_000),
      }),
      hero: cloudDialogHeroSchema,
      buttons: z
        .array(
          z.object({
            id: cloudDialogIdSchema,
            label: z.string().min(1).max(200),
            variant: z.enum(["primary", "secondary", "link"]),
            theme: cloudDialogButtonThemeSchema.nullish(),
            actionId: cloudDialogIdSchema,
          }),
        )
        .max(4),
    }),
    actions: z
      .record(cloudDialogIdSchema, cloudDialogActionSchema)
      .refine((value) => Object.keys(value).length <= 16),
  })
  .superRefine((payload, context) => {
    const seen = new Set<string>();
    for (const button of payload.dialog.buttons) {
      if (seen.has(button.id) || !Object.hasOwn(payload.actions, button.actionId)) {
        context.addIssue({ code: "custom", message: "Duplicate button or missing action" });
      }
      seen.add(button.id);
    }
  });

export type CloudDialogPayloadContract = z.infer<typeof cloudDialogPayloadSchema>;

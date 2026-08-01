import { z } from "zod";

export const INTERACTION_SCHEMA_VERSION = 1 as const;
export const INTERACTION_RECOMMENDATION_POLICY_VERSION = "axora-rules-v1" as const;

const EXECUTABLE_TEXT_PATTERN = /(?:<\/?script\b|javascript\s*:|on[a-z]+\s*=|=>|\b(?:eval|Function|import|require)\s*\()/i;

const safeText = (label: string, maximum: number) => z.string()
  .trim()
  .min(1, `${label} is required.`)
  .max(maximum, `${label} must be ${maximum} characters or fewer.`)
  .refine((value) => !EXECUTABLE_TEXT_PATTERN.test(value), `${label} cannot contain executable code.`);

const uniqueList = <T extends z.ZodTypeAny>(item: T, maximum: number) => z.array(item)
  .max(maximum)
  .refine((values) => new Set(values).size === values.length, "Duplicate values are not allowed.");

export const InteractionTypeSchema = z.enum([
  "none",
  "restrained-motion",
  "abstract-illustration",
  "product-diagram",
  "mascot",
  "guided-character",
  "interactive-background",
  "scroll-narrative",
  "lightweight-2d-scene",
]);
export type InteractionType = z.infer<typeof InteractionTypeSchema>;

export const ActiveInteractionTypeSchema = z.enum([
  "restrained-motion",
  "abstract-illustration",
  "product-diagram",
  "mascot",
  "guided-character",
  "interactive-background",
  "scroll-narrative",
  "lightweight-2d-scene",
]);
export type ActiveInteractionType = z.infer<typeof ActiveInteractionTypeSchema>;

export const InteractionAssetIdSchema = z.enum([
  "none",
  "axora-buddy-v1",
  "axora-restrained-motion-v1",
  "axora-orbit-v1",
  "axora-mark-static-v1",
]);
export type InteractionAssetId = z.infer<typeof InteractionAssetIdSchema>;

export const ActiveInteractionAssetIdSchema = z.enum([
  "axora-buddy-v1",
  "axora-restrained-motion-v1",
  "axora-orbit-v1",
  "axora-mark-static-v1",
]);

export const InteractionStateNameSchema = z.enum([
  "loading",
  "idle",
  "walking-left",
  "walking-right",
  "turning",
  "hovered",
  "pressed",
  "grabbed",
  "being-carried",
  "released",
  "falling",
  "landing",
  "recovering",
  "reacting",
  "sleeping",
  "paused",
  "hidden",
  "reduced-motion",
  "error-fallback",
  "unmounted",
]);
export type InteractionStateName = z.infer<typeof InteractionStateNameSchema>;

export const InteractionTriggerSchema = z.enum([
  "pointer",
  "hover",
  "scroll",
  "nearby-section",
  "visibility",
  "route",
  "resize",
]);
export type InteractionTrigger = z.infer<typeof InteractionTriggerSchema>;

export const ProtectedZoneSchema = z.enum([
  "primary-navigation",
  "forms",
  "calls-to-action",
  "consent",
  "legal",
]);
export type ProtectedZone = z.infer<typeof ProtectedZoneSchema>;

export const InteractionFallbackSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("static-svg"),
    assetId: ActiveInteractionAssetIdSchema,
  }).strict(),
  z.object({
    kind: z.literal("static-component"),
    assetId: ActiveInteractionAssetIdSchema,
  }).strict(),
  z.object({
    kind: z.literal("hidden"),
    assetId: z.literal("none"),
  }).strict(),
]);
export type InteractionFallback = z.infer<typeof InteractionFallbackSchema>;

const COMMON_CONFIG_SHAPE = {
  schemaVersion: z.literal(INTERACTION_SCHEMA_VERSION),
  scale: z.number().finite().min(0.5).max(1.5),
  initialPlacement: z.enum([
    "hero-left",
    "hero-right",
    "feature-area",
    "inline",
    "fixed-bottom-left",
    "fixed-bottom-right",
  ]),
  permittedRegion: z.enum(["hero", "features", "showcase", "footer"]),
  desktopBehavior: z.enum(["full", "reduced", "static", "hidden"]),
  mobileBehavior: z.enum(["full", "reduced", "static", "hidden"]),
  reducedMotionBehavior: z.enum(["static", "hidden"]),
  performanceTier: z.enum(["low", "balanced", "rich"]),
  semanticRole: z.enum(["decorative", "informative"]),
  accessibleLabel: z.union([safeText("Accessible label", 160), z.null()]),
  colorTreatment: z.enum(["brand", "neutral", "monochrome", "high-contrast"]),
  allowVisitorPause: z.boolean(),
  allowVisitorDismiss: z.boolean(),
  protectedZones: uniqueList(ProtectedZoneSchema, 5),
} as const;

export const ActiveInteractionConfigSchema = z.object({
  ...COMMON_CONFIG_SHAPE,
  enabled: z.literal(true),
  interactionType: ActiveInteractionTypeSchema,
  assetId: ActiveInteractionAssetIdSchema,
  intensity: z.enum(["subtle", "moderate", "lively"]),
  dragEnabled: z.boolean(),
  automaticMovement: z.boolean(),
  reactionsEnabled: z.boolean(),
  walkingSpeed: z.number().finite().min(8).max(120),
  idleFrequencySeconds: z.number().finite().min(2).max(60),
  resumeDelayMs: z.number().finite().int().min(200).max(5_000),
  fallback: InteractionFallbackSchema,
  approvedStates: uniqueList(InteractionStateNameSchema, 20).min(1),
  interactionTriggers: uniqueList(InteractionTriggerSchema, 7),
}).strict().superRefine((config, context) => {
  if (config.semanticRole === "decorative" && config.accessibleLabel !== null) {
    context.addIssue({
      code: "custom",
      path: ["accessibleLabel"],
      message: "Decorative interactions must not expose an accessible label.",
    });
  }
  if (config.semanticRole === "informative" && config.accessibleLabel === null) {
    context.addIssue({
      code: "custom",
      path: ["accessibleLabel"],
      message: "Informative interactions require an accessible label.",
    });
  }
  if (config.dragEnabled && !config.interactionTriggers.includes("pointer")) {
    context.addIssue({
      code: "custom",
      path: ["interactionTriggers"],
      message: "Dragging requires the approved pointer trigger.",
    });
  }
  if (config.automaticMovement && !config.approvedStates.some((state) => state === "walking-left" || state === "walking-right")) {
    context.addIssue({
      code: "custom",
      path: ["approvedStates"],
      message: "Automatic movement requires an approved walking state.",
    });
  }
});
export type ActiveInteractionConfig = z.infer<typeof ActiveInteractionConfigSchema>;

export const DisabledInteractionConfigSchema = z.object({
  ...COMMON_CONFIG_SHAPE,
  enabled: z.literal(false),
  interactionType: z.literal("none"),
  assetId: z.literal("none"),
  intensity: z.literal("none"),
  dragEnabled: z.literal(false),
  automaticMovement: z.literal(false),
  reactionsEnabled: z.literal(false),
  walkingSpeed: z.literal(0),
  idleFrequencySeconds: z.literal(0),
  resumeDelayMs: z.literal(0),
  fallback: z.object({ kind: z.literal("hidden"), assetId: z.literal("none") }).strict(),
  approvedStates: z.tuple([]),
  interactionTriggers: z.tuple([]),
}).strict().superRefine((config, context) => {
  if (config.accessibleLabel !== null) {
    context.addIssue({
      code: "custom",
      path: ["accessibleLabel"],
      message: "A disabled interaction cannot expose an accessible label.",
    });
  }
});
export type DisabledInteractionConfig = z.infer<typeof DisabledInteractionConfigSchema>;

export const InteractionConfigSchema = z.union([
  ActiveInteractionConfigSchema,
  DisabledInteractionConfigSchema,
]);
export type InteractionConfig = z.infer<typeof InteractionConfigSchema>;

export const InteractionRecommendationSchema = z.object({
  schemaVersion: z.literal(INTERACTION_SCHEMA_VERSION),
  recommendationId: z.string().regex(/^rec_[a-z0-9_-]{6,80}$/),
  policyVersion: z.literal(INTERACTION_RECOMMENDATION_POLICY_VERSION),
  config: InteractionConfigSchema,
  rationale: safeText("Recommendation rationale", 320),
  confidence: z.enum(["low", "medium", "high"]),
  metrics: z.object({
    toneFit: z.number().finite().int().min(0).max(100),
    accessibilityFit: z.number().finite().int().min(0).max(100),
    performanceFit: z.number().finite().int().min(0).max(100),
  }).strict(),
  alternativeAssetIds: uniqueList(InteractionAssetIdSchema, 4),
}).strict();
export type InteractionRecommendation = z.infer<typeof InteractionRecommendationSchema>;

export const OwnerInteractionChoiceSchema = z.object({
  schemaVersion: z.literal(INTERACTION_SCHEMA_VERSION),
  recommendationId: z.string().regex(/^rec_[a-z0-9_-]{6,80}$/),
  decision: z.enum(["accepted", "replaced", "customized", "disabled"]),
  config: InteractionConfigSchema,
  savedAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((choice, context) => {
  if (choice.decision === "disabled" && choice.config.enabled) {
    context.addIssue({ code: "custom", path: ["config", "enabled"], message: "A disabled choice must use a disabled configuration." });
  }
});
export type OwnerInteractionChoice = z.infer<typeof OwnerInteractionChoiceSchema>;

const BrandPersonalitySchema = z.enum([
  "formal",
  "friendly",
  "playful",
  "modern",
  "technical",
  "calm",
  "bold",
  "premium",
]);

export const CompanyInteractionProfileSchema = z.object({
  companyName: safeText("Company name", 160),
  industry: safeText("Industry", 120),
  brandPersonality: uniqueList(BrandPersonalitySchema, 5).min(1),
  hasLogo: z.boolean(),
  paletteStyle: z.enum(["restrained", "vibrant", "neutral", "natural", "unknown"]),
  servicesOrProducts: uniqueList(safeText("Service or product", 100), 12),
  intendedAudience: z.enum(["business", "consumer", "children", "students", "patients", "public", "mixed"]),
  websitePurpose: z.enum(["company-profile", "lead-generation", "ecommerce", "education", "support", "portfolio"]),
  accessibility: z.object({
    reducedMotionPriority: z.boolean(),
    cognitiveSimplicityPriority: z.boolean(),
  }).strict(),
  deviceMix: z.enum(["desktop-first", "mobile-first", "balanced"]),
  performanceCondition: z.enum(["low", "standard", "high"]),
}).strict();
export type CompanyInteractionProfile = z.infer<typeof CompanyInteractionProfileSchema>;

export function parseInteractionConfig(input: unknown): InteractionConfig {
  return InteractionConfigSchema.parse(input);
}

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import sharp from "sharp";
import { z } from "zod";
import type { SessionUser } from "./auth";
import {
  analyzeLogoPixels,
  brandContrastSummary,
  brandThemeAlternates,
  buildBrandThemeTokens,
  type BrandColorAnalysis,
  type BrandPaletteChoice,
  type BrandThemeTokens,
} from "./brand-colors";
import { isDemoMode, query, withAuditTransaction } from "./db";
import type { Company } from "./types";
import {
  createCompanyLeadInTransaction,
  markCompanyBrandReadyInTransaction,
  notifyCompanyLifecycleMutation,
} from "./company-lifecycle";

export const COMPANY_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const COMPANY_LOGO_MAX_DIMENSION = 4096;
export const BRAND_ALGORITHM_VERSION = "axora-logo-quantize-v1";
export const BRAND_REVIEW_ALGORITHM_VERSION = "axora-logo-review-v1";

export const COMPANY_BRAND_WORKFLOW_STATUSES = [
  "REVIEW_REQUIRED",
  "APPROVED",
  "PUBLISHED",
  "REJECTED",
  "SUPERSEDED",
] as const;
export type CompanyBrandWorkflowStatus =
  (typeof COMPANY_BRAND_WORKFLOW_STATUSES)[number];

export const COMPANY_LOGO_VARIANTS = [
  "ORIGINAL",
  "MONOCHROME",
  "INVERTED",
] as const;
export type CompanyLogoVariant = (typeof COMPANY_LOGO_VARIANTS)[number];

export const COMPANY_LOGO_PLACEMENTS = [
  "HEADER_START",
  "HEADER_CENTER",
] as const;
export type CompanyLogoPlacement = (typeof COMPANY_LOGO_PLACEMENTS)[number];

export const COMPANY_THEME_PREFERENCES = ["LIGHT", "DARK"] as const;
export type CompanyThemePreference =
  (typeof COMPANY_THEME_PREFERENCES)[number];

export const COMPANY_PAGE_COMPONENTS = [
  "hero",
  "requestSummary",
  "budgetSummary",
  "recentActivity",
] as const;

export const DEFAULT_COMPANY_PAGE_CONFIGURATION = {
  schemaVersion: 1 as const,
  components: [...COMPANY_PAGE_COMPONENTS],
};

export type CompanyLogoQualityWarning =
  | "LOW_RESOLUTION"
  | "TRANSPARENCY"
  | "MONOCHROME"
  | "FALLBACK_PALETTE";

const MIME_BY_FORMAT = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export interface ProcessedCompanyLogo {
  bytes: Buffer;
  fileName: string;
  contentType: (typeof MIME_BY_FORMAT)[keyof typeof MIME_BY_FORMAT];
  width: number;
  height: number;
  hasTransparency: boolean;
  sha256: string;
  analysis: BrandColorAnalysis;
  qualityWarnings: CompanyLogoQualityWarning[];
}

function safeFileName(fileName: string) {
  const base = fileName.trim().split(/[\\/]/).pop() ?? "company-logo";
  const sanitized = base
    .replace(/[^A-Za-z0-9._ -]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 180);
  return sanitized || "company-logo";
}

function logoQualityWarnings(
  width: number,
  height: number,
  hasTransparency: boolean,
  analysis: BrandColorAnalysis,
) {
  const warnings: CompanyLogoQualityWarning[] = [];
  if (Math.min(width, height) < 96) warnings.push("LOW_RESOLUTION");
  if (hasTransparency) warnings.push("TRANSPARENCY");
  if (analysis.dominantColors.length <= 1) warnings.push("MONOCHROME");
  if (analysis.usedFallback) warnings.push("FALLBACK_PALETTE");
  return warnings;
}

export async function processCompanyLogo(
  bytes: Buffer,
  fileName: string,
  claimedContentType?: string,
): Promise<ProcessedCompanyLogo> {
  if (bytes.length < 1 || bytes.length > COMPANY_LOGO_MAX_BYTES) {
    throw new Error("Company logos must be between 1 byte and 2 MB.");
  }
  const image = sharp(bytes, {
    animated: false,
    failOn: "warning",
    limitInputPixels: 16_777_216,
  });
  const metadata = await image.metadata();
  if (!metadata.format || !(metadata.format in MIME_BY_FORMAT)) {
    throw new Error("Use a PNG, JPEG, or WebP company logo.");
  }
  const contentType = MIME_BY_FORMAT[
    metadata.format as keyof typeof MIME_BY_FORMAT
  ];
  if (claimedContentType && claimedContentType !== contentType) {
    throw new Error("The uploaded logo type does not match its file content.");
  }
  if (!metadata.width || !metadata.height
    || metadata.width > COMPANY_LOGO_MAX_DIMENSION
    || metadata.height > COMPANY_LOGO_MAX_DIMENSION) {
    throw new Error("Company logo dimensions must be between 1 and 4096 pixels.");
  }
  if ((metadata.pages ?? 1) !== 1) {
    throw new Error("Animated or multi-page company logos are not supported.");
  }

  const normalized = await image
    .rotate()
    .toColorspace("srgb")
    .png({ compressionLevel: 9 })
    .toBuffer();
  const raw = await sharp(normalized)
    .resize({
      width: 192,
      height: 192,
      fit: "inside",
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const analysis = analyzeLogoPixels(raw.data, raw.info.channels);
  const hasTransparency = Boolean(metadata.hasAlpha);

  return {
    bytes: normalized,
    fileName: safeFileName(fileName).replace(/\.[^.]+$/, "") + ".png",
    contentType: "image/png",
    width: metadata.width,
    height: metadata.height,
    hasTransparency,
    sha256: createHash("sha256").update(normalized).digest("hex"),
    analysis,
    qualityWarnings: logoQualityWarnings(
      metadata.width,
      metadata.height,
      hasTransparency,
      analysis,
    ),
  };
}

const colorSchema = z.string().regex(/^#[0-9A-F]{6}$/);
const tokenSchema = z.object({
  primary: colorSchema,
  primaryHover: colorSchema,
  primaryActive: colorSchema,
  secondary: colorSchema,
  accent: colorSchema,
  primaryForeground: colorSchema,
  secondaryForeground: colorSchema,
  pageBackground: colorSchema,
  darkPageBackground: colorSchema,
  surface: colorSchema,
  darkSurface: colorSchema,
  mutedSurface: colorSchema,
  border: colorSchema,
  darkBorder: colorSchema,
  text: colorSchema,
  textInverse: colorSchema,
  icon: colorSchema,
  iconInverse: colorSchema,
  success: colorSchema,
  warning: colorSchema,
  danger: colorSchema,
  focusRing: colorSchema,
  link: colorSchema,
  chart: z.array(colorSchema).min(3).max(8),
});

const contrastSchema = z.object({
  primaryForeground: z.number(),
  primaryHoverForeground: z.number(),
  primaryActiveForeground: z.number(),
  secondaryForeground: z.number(),
  textOnBackground: z.number(),
  textInverseOnDark: z.number(),
  iconOnBackground: z.number(),
  iconInverseOnDark: z.number(),
  linkOnBackground: z.number(),
  focusOnBackground: z.number(),
  passes: z.boolean(),
});

const pageConfigurationSchema = z.object({
  schemaVersion: z.literal(1),
  components: z.array(z.enum(COMPANY_PAGE_COMPONENTS)).min(1).max(8),
});

const evidencePersonSchema = z.object({
  id: z.uuid().nullable(),
  name: z.string().nullable(),
  at: z.string().optional(),
});

const themeVersionSchema = z.object({
  id: z.uuid(),
  companyId: z.uuid(),
  sourceLogoId: z.uuid(),
  sourceLogoHash: z.string().regex(/^[0-9a-f]{64}$/),
  version: z.number().int().positive(),
  algorithmVersion: z.string(),
  status: z.enum(COMPANY_BRAND_WORKFLOW_STATUSES),
  active: z.boolean(),
  tokens: tokenSchema,
  extractionSummary: z.record(z.string(), z.unknown()),
  contrastSummary: contrastSchema,
  manualOverrides: z.record(z.string(), z.unknown()),
  pageConfiguration: pageConfigurationSchema,
  logoVariant: z.enum(COMPANY_LOGO_VARIANTS),
  logoPlacement: z.enum(COMPANY_LOGO_PLACEMENTS),
  themePreference: z.enum(COMPANY_THEME_PREFERENCES),
  sourceThemeId: z.uuid().nullable(),
  rollbackOfThemeId: z.uuid().nullable(),
  createdAt: z.string(),
  createdBy: z.object({
    id: z.uuid(),
    name: z.string(),
  }).nullable(),
  reviewedBy: evidencePersonSchema.nullable(),
  publishedBy: evidencePersonSchema.nullable(),
});

const eventSchema = z.object({
  id: z.uuid(),
  themeId: z.uuid(),
  eventVersion: z.number().int().positive(),
  fromStatus: z.string().nullable(),
  status: z.string(),
  action: z.string(),
  reason: z.string(),
  createdAt: z.string(),
  actor: z.object({
    id: z.uuid(),
    name: z.string(),
  }).nullable(),
});

const workspaceSchema = z.object({
  company: z.object({
    id: z.uuid(),
    name: z.string(),
    code: z.string(),
  }),
  canPublish: z.boolean(),
  publishedThemeId: z.uuid().nullable(),
  themes: z.array(themeVersionSchema),
  events: z.array(eventSchema),
});

const mutationSchema = z.object({
  status: z.string(),
  themeId: z.uuid(),
  logoId: z.uuid().optional(),
  rollbackOfThemeId: z.uuid().optional(),
});

const activeBrandSchema = themeVersionSchema.extend({
  companyId: z.uuid(),
  companyName: z.string(),
  logoContentType: z.string(),
});

export type CompanyBrandThemeVersion = z.infer<typeof themeVersionSchema>;
export type CompanyBrandReviewWorkspace = z.infer<typeof workspaceSchema>;
export type CompanyBrandMutation = z.infer<typeof mutationSchema>;

export class CompanyBrandUnavailableError extends Error {
  constructor() {
    super("The company branding workspace is unavailable.");
    this.name = "CompanyBrandUnavailableError";
  }
}

function requiredAssignment(actor: SessionUser) {
  const parsed = z.uuid().safeParse(actor.roleAssignmentId);
  if (!parsed.success) throw new CompanyBrandUnavailableError();
  return parsed.data;
}

function extractionSummary(logo: ProcessedCompanyLogo) {
  return {
    dominantColors: logo.analysis.dominantColors,
    sampledOpaquePixels: logo.analysis.sampledOpaquePixels,
    usedFallback: logo.analysis.usedFallback,
    qualityWarnings: logo.qualityWarnings,
    sourceDimensions: {
      width: logo.width,
      height: logo.height,
    },
    hasTransparency: logo.hasTransparency,
  };
}

async function saveLogoAndTheme(
  client: PoolClient,
  companyId: string,
  logo: ProcessedCompanyLogo,
  actor: SessionUser,
  reason: string,
  sourceThemeId: string | null = null,
) {
  const result = await client.query<{ snapshot: unknown }>(
    "SELECT public.axora_create_company_brand_draft(" +
      "$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb," +
      "$14::jsonb,$15::jsonb,$16::jsonb,$17,$18,$19,$20,$21,$22" +
      ") AS snapshot",
    [
      actor.id,
      requiredAssignment(actor),
      z.uuid().parse(companyId),
      logo.fileName,
      logo.contentType,
      logo.bytes,
      logo.sha256,
      logo.width,
      logo.height,
      logo.hasTransparency,
      BRAND_ALGORITHM_VERSION,
      JSON.stringify(logo.analysis.tokens),
      JSON.stringify(extractionSummary(logo)),
      JSON.stringify(logo.analysis.contrast),
      JSON.stringify({}),
      JSON.stringify(DEFAULT_COMPANY_PAGE_CONFIGURATION),
      "ORIGINAL",
      "HEADER_START",
      "LIGHT",
      sourceThemeId,
      reason,
      new Date(),
    ],
  );
  const parsed = mutationSchema.safeParse(result.rows[0]?.snapshot);
  if (!parsed.success) throw new CompanyBrandUnavailableError();
  return {
    logoId: parsed.data.logoId ?? "",
    themeId: parsed.data.themeId,
  };
}

type NewCompanyWithBrand = Omit<
  Company,
  "id" | "code" | "status" | "taxRate" | "estimatedDeliveryFee"
> & {
  legalName: string;
  registrationNumber: string;
};

export async function createCompanyWithBrand(
  input: NewCompanyWithBrand,
  logoFile: File,
  actor: SessionUser,
) {
  const logo = await processCompanyLogo(
    Buffer.from(await logoFile.arrayBuffer()),
    logoFile.name,
    logoFile.type || undefined,
  );
  if (isDemoMode()) {
    return {
      companyId: "demo-company",
      logoId: "demo-logo",
      themeId: "demo-theme",
      logo,
    };
  }
  return withAuditTransaction(
    {
      actor,
      reason: "Customer company registered with a reviewed branding draft",
    },
    async (client) => {
      const mutation = await createCompanyLeadInTransaction(client, input, actor);
      const branded = await saveLogoAndTheme(
        client,
        mutation.companyId,
        logo,
        actor,
        "Company logo uploaded and deterministic draft generated for review",
      );
      await notifyCompanyLifecycleMutation(client, mutation, actor);
      return {
        companyId: mutation.companyId,
        ...branded,
        logo,
      };
    },
  );
}

export async function regenerateCompanyBrand(
  companyId: string,
  bytes: Buffer,
  fileName: string,
  claimedContentType: string | undefined,
  actor: SessionUser,
) {
  const logo = await processCompanyLogo(bytes, fileName, claimedContentType);
  if (isDemoMode()) {
    return { logoId: "demo-logo", themeId: "demo-theme", logo };
  }
  const saved = await withAuditTransaction(
    {
      actor,
      reason: "Replacement logo generated a new unpublished company theme",
    },
    (client) => saveLogoAndTheme(
      client,
      companyId,
      logo,
      actor,
      "Replacement logo uploaded and deterministic draft generated for review",
    ),
  );
  return { ...saved, logo };
}

function demoWorkspace(companyId: string): CompanyBrandReviewWorkspace {
  const now = new Date().toISOString();
  const tokens = buildBrandThemeTokens();
  const themeId = "11111111-1111-4111-8111-111111111117";
  const logoId = "11111111-1111-4111-8111-111111111118";
  const eventStatuses = [
    "LOGO_UPLOADED",
    "ANALYSIS_QUEUED",
    "DRAFT_GENERATED",
    "REVIEW_REQUIRED",
  ];
  return {
    company: {
      id: z.uuid().parse(companyId),
      name: "Northstar Facilities",
      code: "AX-DEMO",
    },
    canPublish: true,
    publishedThemeId: null,
    themes: [{
      id: themeId,
      companyId: z.uuid().parse(companyId),
      sourceLogoId: logoId,
      sourceLogoHash: "a".repeat(64),
      version: 1,
      algorithmVersion: BRAND_ALGORITHM_VERSION,
      status: "REVIEW_REQUIRED",
      active: false,
      tokens,
      extractionSummary: {
        dominantColors: [tokens.primary, tokens.accent],
        sampledOpaquePixels: 4096,
        usedFallback: false,
        qualityWarnings: [],
      },
      contrastSummary: brandContrastSummary(tokens),
      manualOverrides: {},
      pageConfiguration: DEFAULT_COMPANY_PAGE_CONFIGURATION,
      logoVariant: "ORIGINAL",
      logoPlacement: "HEADER_START",
      themePreference: "LIGHT",
      sourceThemeId: null,
      rollbackOfThemeId: null,
      createdAt: now,
      createdBy: null,
      reviewedBy: null,
      publishedBy: null,
    }],
    events: eventStatuses.map((status, index) => ({
      id: "22222222-2222-4222-8222-11111111111" + (index + 1),
      themeId,
      eventVersion: index + 1,
      fromStatus: index ? eventStatuses[index - 1] : null,
      status,
      action: status === "REVIEW_REQUIRED"
        ? "REVIEW_REQUESTED"
        : status,
      reason: "Deterministic demonstration branding workflow",
      createdAt: now,
      actor: null,
    })),
  };
}

export async function getCompanyBrandReviewWorkspace(
  companyId: string,
  actor: SessionUser,
) {
  if (isDemoMode()) return demoWorkspace(companyId);
  try {
    const result = await query<{ snapshot: unknown }>(
      "SELECT public.axora_company_brand_review_workspace(" +
        "$1,$2,$3,$4) AS snapshot",
      [
        actor.id,
        requiredAssignment(actor),
        z.uuid().parse(companyId),
        new Date(),
      ],
    );
    const parsed = workspaceSchema.safeParse(result.rows[0]?.snapshot);
    if (!parsed.success) throw new CompanyBrandUnavailableError();
    return parsed.data;
  } catch (error) {
    if (error instanceof CompanyBrandUnavailableError) throw error;
    throw new CompanyBrandUnavailableError();
  }
}

async function saveThemeVariant(
  companyId: string,
  baseTheme: CompanyBrandThemeVersion,
  tokens: BrandThemeTokens,
  extraction: Record<string, unknown>,
  manualOverrides: Record<string, unknown>,
  logoVariant: CompanyLogoVariant,
  logoPlacement: CompanyLogoPlacement,
  themePreference: CompanyThemePreference,
  reason: string,
  actor: SessionUser,
) {
  if (isDemoMode()) {
    return {
      status: "REVIEW_REQUIRED",
      themeId: "33333333-3333-4333-8333-333333333333",
      logoId: baseTheme.sourceLogoId,
    } satisfies CompanyBrandMutation;
  }
  return withAuditTransaction({ actor, reason }, async (client) => {
    const result = await client.query<{ snapshot: unknown }>(
      "SELECT public.axora_create_company_brand_variant(" +
        "$1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb," +
        "$10::jsonb,$11,$12,$13,$14,$15) AS snapshot",
      [
        actor.id,
        requiredAssignment(actor),
        z.uuid().parse(companyId),
        baseTheme.id,
        BRAND_REVIEW_ALGORITHM_VERSION,
        JSON.stringify(tokens),
        JSON.stringify(extraction),
        JSON.stringify(brandContrastSummary(tokens)),
        JSON.stringify(manualOverrides),
        JSON.stringify(baseTheme.pageConfiguration),
        logoVariant,
        logoPlacement,
        themePreference,
        reason,
        new Date(),
      ],
    );
    const parsed = mutationSchema.safeParse(result.rows[0]?.snapshot);
    if (!parsed.success) throw new CompanyBrandUnavailableError();
    return parsed.data;
  });
}

async function selectedBaseTheme(
  companyId: string,
  baseThemeId: string,
  actor: SessionUser,
) {
  const workspace = await getCompanyBrandReviewWorkspace(companyId, actor);
  const baseTheme = workspace.themes.find((theme) => theme.id === baseThemeId);
  if (!baseTheme) throw new CompanyBrandUnavailableError();
  return baseTheme;
}

export async function createCompanyBrandPaletteDraft(
  companyId: string,
  baseThemeId: string,
  paletteChoice: BrandPaletteChoice,
  actor: SessionUser,
) {
  const baseTheme = await selectedBaseTheme(companyId, baseThemeId, actor);
  const tokens = brandThemeAlternates(baseTheme.tokens)[paletteChoice];
  return saveThemeVariant(
    companyId,
    baseTheme,
    tokens,
    {
      ...baseTheme.extractionSummary,
      generatedFromThemeId: baseTheme.id,
      paletteChoice,
    },
    { paletteChoice },
    baseTheme.logoVariant,
    baseTheme.logoPlacement,
    baseTheme.themePreference,
    "Reviewer selected the " + paletteChoice + " controlled palette",
    actor,
  );
}

export interface CompanyBrandCustomInput {
  primary: string;
  secondary: string;
  accent: string;
  pageBackground: string;
  darkPageBackground: string;
  text: string;
  textInverse: string;
  icon: string;
  iconInverse: string;
  logoVariant: CompanyLogoVariant;
  logoPlacement: CompanyLogoPlacement;
  themePreference: CompanyThemePreference;
  reason: string;
}

export async function createCompanyBrandCustomDraft(
  companyId: string,
  baseThemeId: string,
  input: CompanyBrandCustomInput,
  actor: SessionUser,
) {
  const baseTheme = await selectedBaseTheme(companyId, baseThemeId, actor);
  const tokens = buildBrandThemeTokens({
    primary: input.primary,
    secondary: input.secondary,
    accent: input.accent,
    pageBackground: input.pageBackground,
    darkPageBackground: input.darkPageBackground,
    text: input.text,
    textInverse: input.textInverse,
    icon: input.icon,
    iconInverse: input.iconInverse,
  });
  return saveThemeVariant(
    companyId,
    baseTheme,
    tokens,
    {
      ...baseTheme.extractionSummary,
      generatedFromThemeId: baseTheme.id,
      manualReview: true,
    },
    {
      primary: input.primary,
      secondary: input.secondary,
      accent: input.accent,
      pageBackground: input.pageBackground,
      darkPageBackground: input.darkPageBackground,
      text: input.text,
      textInverse: input.textInverse,
      icon: input.icon,
      iconInverse: input.iconInverse,
      logoVariant: input.logoVariant,
      logoPlacement: input.logoPlacement,
      themePreference: input.themePreference,
    },
    input.logoVariant,
    input.logoPlacement,
    input.themePreference,
    input.reason,
    actor,
  );
}

export type CompanyBrandTransitionAction = "APPROVE" | "REJECT" | "PUBLISH";

export async function transitionCompanyBrandTheme(
  companyId: string,
  themeId: string,
  action: CompanyBrandTransitionAction,
  reason: string,
  actor: SessionUser,
) {
  if (isDemoMode()) {
    return {
      status: action === "APPROVE" ? "APPROVED" : action === "REJECT"
        ? "REJECTED"
        : "PUBLISHED",
      themeId: z.uuid().parse(themeId),
    } satisfies CompanyBrandMutation;
  }
  return withAuditTransaction({ actor, reason }, async (client) => {
    const result = await client.query<{ snapshot: unknown }>(
      "SELECT public.axora_transition_company_brand_theme(" +
        "$1,$2,$3,$4,$5,$6,$7) AS snapshot",
      [
        actor.id,
        requiredAssignment(actor),
        z.uuid().parse(companyId),
        z.uuid().parse(themeId),
        action,
        reason,
        new Date(),
      ],
    );
    const parsed = mutationSchema.safeParse(result.rows[0]?.snapshot);
    if (!parsed.success) throw new CompanyBrandUnavailableError();
    if (action === "PUBLISH" && parsed.data.status === "PUBLISHED") {
      await markCompanyBrandReadyInTransaction(client, companyId, actor);
    }
    return parsed.data;
  });
}

export async function rollbackCompanyBrandTheme(
  companyId: string,
  targetThemeId: string,
  reason: string,
  actor: SessionUser,
) {
  if (isDemoMode()) {
    return {
      status: "PUBLISHED",
      themeId: "44444444-4444-4444-8444-444444444444",
      rollbackOfThemeId: z.uuid().parse(targetThemeId),
    } satisfies CompanyBrandMutation;
  }
  return withAuditTransaction({ actor, reason }, async (client) => {
    const result = await client.query<{ snapshot: unknown }>(
      "SELECT public.axora_rollback_company_brand_theme(" +
        "$1,$2,$3,$4,$5,$6) AS snapshot",
      [
        actor.id,
        requiredAssignment(actor),
        z.uuid().parse(companyId),
        z.uuid().parse(targetThemeId),
        reason,
        new Date(),
      ],
    );
    const parsed = mutationSchema.safeParse(result.rows[0]?.snapshot);
    if (!parsed.success) throw new CompanyBrandUnavailableError();
    if (parsed.data.status === "PUBLISHED") {
      await markCompanyBrandReadyInTransaction(client, companyId, actor);
    }
    return parsed.data;
  });
}

export interface ActiveCompanyBrand {
  companyId: string;
  companyName: string;
  logoId: string;
  logoContentType: string;
  themeVersion: number;
  logoVariant: CompanyLogoVariant;
  logoPlacement: CompanyLogoPlacement;
  themePreference: CompanyThemePreference;
  tokens: BrandThemeTokens;
}

export async function getActiveCompanyBrand(
  companyId: string,
  actor: SessionUser,
): Promise<ActiveCompanyBrand | null> {
  if (isDemoMode()) return null;
  const result = await query<{ snapshot: unknown }>(
    "SELECT public.axora_active_company_brand($1,$2,$3,$4) AS snapshot",
    [
      actor.id,
      requiredAssignment(actor),
      z.uuid().parse(companyId),
      new Date(),
    ],
  );
  if (result.rows[0]?.snapshot === null) return null;
  const parsed = activeBrandSchema.safeParse(result.rows[0]?.snapshot);
  if (!parsed.success) throw new CompanyBrandUnavailableError();
  return {
    companyId: parsed.data.companyId,
    companyName: parsed.data.companyName,
    logoId: parsed.data.sourceLogoId,
    logoContentType: parsed.data.logoContentType,
    themeVersion: parsed.data.version,
    logoVariant: parsed.data.logoVariant,
    logoPlacement: parsed.data.logoPlacement,
    themePreference: parsed.data.themePreference,
    tokens: parsed.data.tokens,
  };
}

export async function getCompanyBrandLogo(
  companyId: string,
  themeId: string | null,
  actor: SessionUser,
) {
  if (isDemoMode()) return null;
  const result = await query<{
    bytes: Buffer;
    contentType: string;
    sha256: string;
  }>(
    "SELECT bytes,content_type AS \"contentType\",sha256 " +
      "FROM public.axora_company_brand_logo($1,$2,$3,$4,$5)",
    [
      actor.id,
      requiredAssignment(actor),
      z.uuid().parse(companyId),
      themeId ? z.uuid().parse(themeId) : null,
      new Date(),
    ],
  );
  return result.rows[0] ?? null;
}

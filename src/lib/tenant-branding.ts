import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import sharp from "sharp";
import type { SessionUser } from "./auth";
import { analyzeLogoPixels, type BrandColorAnalysis, type BrandThemeTokens } from "./brand-colors";
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
}

function safeFileName(fileName: string) {
  const base = fileName.trim().split(/[\\/]/).pop() ?? "company-logo";
  const sanitized = base.replace(/[^A-Za-z0-9._ -]/g, "-").replace(/\s+/g, " ").slice(0, 180);
  return sanitized || "company-logo";
}

export async function processCompanyLogo(
  bytes: Buffer,
  fileName: string,
  claimedContentType?: string,
): Promise<ProcessedCompanyLogo> {
  if (bytes.length < 1 || bytes.length > COMPANY_LOGO_MAX_BYTES) {
    throw new Error("Company logos must be between 1 byte and 2 MB.");
  }
  const image = sharp(bytes, { animated: false, failOn: "warning", limitInputPixels: 16_777_216 });
  const metadata = await image.metadata();
  if (!metadata.format || !(metadata.format in MIME_BY_FORMAT)) {
    throw new Error("Use a PNG, JPEG, or WebP company logo.");
  }
  const contentType = MIME_BY_FORMAT[metadata.format as keyof typeof MIME_BY_FORMAT];
  if (claimedContentType && claimedContentType !== contentType) {
    throw new Error("The uploaded logo type does not match its file content.");
  }
  if (!metadata.width || !metadata.height
    || metadata.width > COMPANY_LOGO_MAX_DIMENSION
    || metadata.height > COMPANY_LOGO_MAX_DIMENSION) {
    throw new Error("Company logo dimensions must be between 1 and 4096 pixels.");
  }
  if ((metadata.pages ?? 1) !== 1) throw new Error("Animated or multi-page company logos are not supported.");

  const normalized = await image.rotate().toColorspace("srgb").png({ compressionLevel: 9 }).toBuffer();
  const raw = await sharp(normalized)
    .resize({ width: 192, height: 192, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const analysis = analyzeLogoPixels(raw.data, raw.info.channels);

  return {
    bytes: normalized,
    fileName: safeFileName(fileName).replace(/\.[^.]+$/, "") + ".png",
    contentType: "image/png",
    width: metadata.width,
    height: metadata.height,
    hasTransparency: Boolean(metadata.hasAlpha),
    sha256: createHash("sha256").update(normalized).digest("hex"),
    analysis,
  };
}

function themeValues(tokens: BrandThemeTokens) {
  return [
    tokens.primary,
    tokens.secondary,
    tokens.accent,
    tokens.primaryForeground,
    tokens.secondaryForeground,
    tokens.pageBackground,
    tokens.surface,
    tokens.mutedSurface,
    tokens.border,
    tokens.success,
    tokens.warning,
    tokens.danger,
    tokens.focusRing,
    tokens.link,
    tokens.chart,
  ];
}

async function saveLogoAndTheme(
  client: PoolClient,
  companyId: string,
  logo: ProcessedCompanyLogo,
  actor: SessionUser,
) {
  const company = await client.query(
    "SELECT id FROM companies WHERE id=$1 AND lifecycle_status<>'ARCHIVED' FOR UPDATE",
    [companyId],
  );
  if (!company.rowCount) throw new Error("The selected company is unavailable.");
  const nextVersion = await client.query<{ version: number }>(`
    SELECT COALESCE(max(version),0)::int+1 AS version FROM company_logos WHERE company_id=$1
  `, [companyId]);
  await client.query("UPDATE company_logos SET active=false WHERE company_id=$1 AND active=true", [companyId]);
  const insertedLogo = await client.query<{ id: string }>(`
    INSERT INTO company_logos(
      company_id,version,file_name,content_type,logo_content,sha256,
      width,height,has_transparency,active,uploaded_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)
    RETURNING id::text
  `, [
    companyId,
    nextVersion.rows[0].version,
    logo.fileName,
    logo.contentType,
    logo.bytes,
    logo.sha256,
    logo.width,
    logo.height,
    logo.hasTransparency,
    actor.id,
  ]);

  const nextThemeVersion = await client.query<{ version: number }>(`
    SELECT COALESCE(max(version),0)::int+1 AS version FROM company_brand_themes WHERE company_id=$1
  `, [companyId]);
  await client.query("UPDATE company_brand_themes SET active=false WHERE company_id=$1 AND active=true", [companyId]);
  const values = themeValues(logo.analysis.tokens);
  const theme = await client.query<{ id: string }>(`
    INSERT INTO company_brand_themes(
      company_id,source_logo_id,version,algorithm_version,
      primary_color,secondary_color,accent_color,primary_foreground,
      secondary_foreground,page_background,surface_color,muted_surface,
      border_color,success_color,warning_color,danger_color,focus_ring,
      link_color,chart_colors,extraction_summary,contrast_summary,active,created_by
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
      $20::jsonb,$21::jsonb,true,$22
    ) RETURNING id::text
  `, [
    companyId,
    insertedLogo.rows[0].id,
    nextThemeVersion.rows[0].version,
    BRAND_ALGORITHM_VERSION,
    ...values,
    JSON.stringify({
      dominantColors: logo.analysis.dominantColors,
      sampledOpaquePixels: logo.analysis.sampledOpaquePixels,
      usedFallback: logo.analysis.usedFallback,
    }),
    JSON.stringify(logo.analysis.contrast),
    actor.id,
  ]);
  return { logoId: insertedLogo.rows[0].id, themeId: theme.rows[0].id };
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
    return { companyId: "demo-company", logoId: "demo-logo", themeId: "demo-theme", logo };
  }
  return withAuditTransaction(
    { actor, reason: "Customer company registered with approved logo and generated theme" },
    async (client) => {
      const mutation = await createCompanyLeadInTransaction(client, input, actor);
      const branded = await saveLogoAndTheme(client, mutation.companyId, logo, actor);
      await markCompanyBrandReadyInTransaction(client, mutation.companyId, actor);
      await notifyCompanyLifecycleMutation(client, mutation, actor);
      return { companyId: mutation.companyId, ...branded, logo };
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
  if (!actor.isOwner) throw new Error("Only an Axora platform owner can regenerate company branding.");
  const logo = await processCompanyLogo(bytes, fileName, claimedContentType);
  if (isDemoMode()) return { logoId: "demo-logo", themeId: "demo-theme", logo };
  const saved = await withAuditTransaction(
    { actor, reason: "Company logo uploaded and accessible theme regenerated" },
    (client) => saveLogoAndTheme(client, companyId, logo, actor),
  );
  return { ...saved, logo };
}

export interface ActiveCompanyBrand {
  companyId: string;
  companyName: string;
  logoId: string;
  logoContentType: string;
  themeVersion: number;
  tokens: BrandThemeTokens;
}

export async function getActiveCompanyBrand(companyId: string): Promise<ActiveCompanyBrand | null> {
  if (isDemoMode()) return null;
  const result = await query<{
    companyId: string;
    companyName: string;
    logoId: string;
    logoContentType: string;
    themeVersion: number;
    primary: string;
    secondary: string;
    accent: string;
    primaryForeground: string;
    secondaryForeground: string;
    pageBackground: string;
    surface: string;
    mutedSurface: string;
    border: string;
    success: string;
    warning: string;
    danger: string;
    focusRing: string;
    link: string;
    chart: string[];
  }>(`
    SELECT theme.company_id::text AS "companyId",company.name AS "companyName",
      logo.id::text AS "logoId",
      logo.content_type AS "logoContentType",theme.version::int AS "themeVersion",
      theme.primary_color AS primary,theme.secondary_color AS secondary,
      theme.accent_color AS accent,theme.primary_foreground AS "primaryForeground",
      theme.secondary_foreground AS "secondaryForeground",
      theme.page_background AS "pageBackground",theme.surface_color AS surface,
      theme.muted_surface AS "mutedSurface",theme.border_color AS border,
      theme.success_color AS success,theme.warning_color AS warning,
      theme.danger_color AS danger,theme.focus_ring AS "focusRing",
      theme.link_color AS link,theme.chart_colors AS chart
    FROM company_brand_themes theme
    JOIN company_logos logo ON logo.id=theme.source_logo_id
    JOIN companies company ON company.id=theme.company_id AND company.active=true
    WHERE theme.company_id=$1 AND theme.active=true AND logo.active=true
    LIMIT 1
  `, [companyId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    companyId: row.companyId,
    companyName: row.companyName,
    logoId: row.logoId,
    logoContentType: row.logoContentType,
    themeVersion: Number(row.themeVersion),
    tokens: {
      primary: row.primary,
      secondary: row.secondary,
      accent: row.accent,
      primaryForeground: row.primaryForeground,
      secondaryForeground: row.secondaryForeground,
      pageBackground: row.pageBackground,
      surface: row.surface,
      mutedSurface: row.mutedSurface,
      border: row.border,
      success: row.success,
      warning: row.warning,
      danger: row.danger,
      focusRing: row.focusRing,
      link: row.link,
      chart: row.chart,
    },
  };
}

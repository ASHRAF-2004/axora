import type { PoolClient } from "pg";
import { z } from "zod";
import { requireSession, type SessionUser } from "../auth";
import { isDemoMode, query, withAuditTransaction } from "../db";
import { getDemoStore } from "../demo-data";
import { canAccess } from "../permissions";
import {
  InteractionConfigSchema,
  InteractionRecommendationSchema,
  OwnerInteractionChoiceSchema,
  type InteractionConfig,
  type InteractionRecommendation,
  type OwnerInteractionChoice,
} from "./schema";
import { assertInteractionPublishable } from "./validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_STORAGE_PATH_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i;

function isSafeRelativeStoragePath(value: string) {
  return value.split("/").every((segment) =>
    segment !== "."
    && segment !== ".."
    && SAFE_STORAGE_PATH_SEGMENT.test(segment));
}

function isHttpSourceUrl(value: string) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

const interactionAssetInputSchema = z.object({
  assetKey: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
  displayName: z.string().trim().min(1).max(120),
  assetType: z.enum(["SVG", "RIVE", "IMAGE", "STATIC_FALLBACK"]),
  contentType: z.enum([
    "image/svg+xml",
    "application/octet-stream",
    "application/rive",
    "image/png",
    "image/jpeg",
    "image/webp",
  ]),
  storagePath: z.string().trim().min(1).max(500)
    .refine((value) => !/^https?:\/\//i.test(value), "Interaction assets must use persistent local storage, not a hotlink.")
    .refine(isSafeRelativeStoragePath, "Interaction asset storage path must be a safe relative path."),
  byteSize: z.number().int().min(1).max(5 * 1024 * 1024),
  sha256: z.string().regex(SHA256_PATTERN),
  sourceUrl: z.string().trim().min(1).max(1000)
    .refine(isHttpSourceUrl, "Interaction asset source URL must use HTTP or HTTPS."),
  licenseName: z.string().trim().min(1).max(200),
  licenseReference: z.string().trim().min(1).max(2000),
  commercialUseApproved: z.literal(true),
  attributionRequired: z.boolean().default(false),
  attributionText: z.string().trim().max(2000).nullable().optional(),
}).strict().superRefine((asset, context) => {
  if (asset.attributionRequired && !asset.attributionText) {
    context.addIssue({
      code: "custom",
      path: ["attributionText"],
      message: "Attribution text is required by this asset license.",
    });
  }
});

export type InteractionAssetInput = z.input<typeof interactionAssetInputSchema>;

export interface CompanyInteractionWorkspace {
  companyId: string;
  companyName: string;
  recommendation: InteractionRecommendation | null;
  ownerChoice: OwnerInteractionChoice | null;
  publishedConfig: InteractionConfig | null;
  recommendedAt: string | null;
  ownerChoiceSavedAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface InteractionRevision {
  id: string;
  companyId: string;
  revisionNumber: number;
  config: InteractionConfig;
  source: "PUBLISH" | "ROLLBACK";
  sourceRevisionId: string | null;
  isCurrent: boolean;
  createdByName: string | null;
  createdAt: string;
}

export interface InteractionAsset {
  id: string;
  companyId: string;
  assetKey: string;
  displayName: string;
  assetType: "SVG" | "RIVE" | "IMAGE" | "STATIC_FALLBACK";
  contentType: string;
  storagePath: string;
  byteSize: number;
  sha256: string;
  sourceUrl: string;
  licenseName: string;
  licenseReference: string;
  commercialUseApproved: true;
  attributionRequired: boolean;
  attributionText: string | null;
  active: boolean;
  createdAt: string;
}

interface WorkspaceRow {
  companyId: string;
  companyName: string;
  recommendation: unknown;
  ownerChoice: unknown;
  publishedConfig: unknown;
  recommendedAt: Date | string | null;
  ownerChoiceSavedAt: Date | string | null;
  publishedAt: Date | string | null;
  updatedAt: Date | string;
}

interface RevisionRow {
  id: string;
  companyId: string;
  revisionNumber: number;
  config: unknown;
  source: "PUBLISH" | "ROLLBACK";
  sourceRevisionId: string | null;
  isCurrent: boolean;
  createdByName: string | null;
  createdAt: Date | string;
}

interface AssetRow extends Omit<InteractionAsset, "byteSize" | "createdAt" | "commercialUseApproved"> {
  byteSize: number | string;
  commercialUseApproved: boolean;
  createdAt: Date | string;
}

function isoDate(value: Date | string | null) {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Stored interaction timestamp is invalid.");
  return parsed.toISOString();
}

function jsonValue(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("Stored interaction configuration is invalid JSON.");
  }
}

function parseWorkspace(row: WorkspaceRow): CompanyInteractionWorkspace {
  return {
    companyId: row.companyId,
    companyName: row.companyName,
    recommendation: row.recommendation === null
      ? null
      : InteractionRecommendationSchema.parse(jsonValue(row.recommendation)),
    ownerChoice: row.ownerChoice === null
      ? null
      : OwnerInteractionChoiceSchema.parse(jsonValue(row.ownerChoice)),
    publishedConfig: row.publishedConfig === null
      ? null
      : InteractionConfigSchema.parse(jsonValue(row.publishedConfig)),
    recommendedAt: isoDate(row.recommendedAt),
    ownerChoiceSavedAt: isoDate(row.ownerChoiceSavedAt),
    publishedAt: isoDate(row.publishedAt),
    updatedAt: isoDate(row.updatedAt)!,
  };
}

function parseRevision(row: RevisionRow): InteractionRevision {
  return {
    ...row,
    revisionNumber: Number(row.revisionNumber),
    // Historical snapshots stay readable if a later policy tightens. A
    // rollback re-runs the current publication gate before becoming live.
    config: InteractionConfigSchema.parse(jsonValue(row.config)),
    createdAt: isoDate(row.createdAt)!,
  };
}

function parseAsset(row: AssetRow): InteractionAsset {
  if (!row.commercialUseApproved || !SHA256_PATTERN.test(row.sha256)) {
    throw new Error("Stored interaction asset approval is invalid.");
  }
  return {
    ...row,
    byteSize: Number(row.byteSize),
    commercialUseApproved: true,
    createdAt: isoDate(row.createdAt)!,
  };
}

async function actorOrSession(actor?: SessionUser) {
  return actor ?? requireSession();
}

function requireInteractionManager(actor: SessionUser) {
  if (!canAccess(actor, "manage_interactions")) {
    throw new Error("Your account cannot manage interactive experiences.");
  }
}

export function resolveInteractionCompanyId(
  actor: SessionUser,
  requestedCompanyId?: string,
) {
  requireInteractionManager(actor);
  const companyId = actor.isOwner ? requestedCompanyId : actor.companyId;
  const isKnownDemoCompany = Boolean(
    companyId
    && isDemoMode()
    && getDemoStore().companies.some((company) => company.id === companyId),
  );
  if (!companyId || (!UUID_PATTERN.test(companyId) && !isKnownDemoCompany)) {
    throw new Error(actor.isOwner ? "Select a company." : "Your account is not assigned to a company.");
  }
  if (!actor.isOwner && requestedCompanyId && requestedCompanyId !== actor.companyId) {
    throw new Error("You cannot manage another company's interactive experience.");
  }
  return companyId;
}

function demoWorkspace(companyId: string): CompanyInteractionWorkspace | null {
  const company = getDemoStore().companies.find((item) => item.id === companyId);
  if (!company) return null;
  return {
    companyId: company.id,
    companyName: company.name,
    recommendation: null,
    ownerChoice: null,
    publishedConfig: null,
    recommendedAt: null,
    ownerChoiceSavedAt: null,
    publishedAt: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function rejectDemoWrite() {
  if (isDemoMode()) {
    throw new Error("Interactive experience changes are unavailable in demonstration mode.");
  }
}

const workspaceSelect = `SELECT
  profile.company_id::text AS "companyId",
  company.name AS "companyName",
  profile.ai_recommendation AS recommendation,
  profile.owner_override AS "ownerChoice",
  profile.published_config AS "publishedConfig",
  profile.ai_recommended_at AS "recommendedAt",
  profile.owner_override_at AS "ownerChoiceSavedAt",
  profile.published_at AS "publishedAt",
  profile.updated_at AS "updatedAt"
FROM company_interaction_profiles profile
JOIN companies company ON company.id=profile.company_id
WHERE profile.company_id=$1 AND company.active=true`;

async function loadWorkspaceWithClient(client: PoolClient, companyId: string) {
  const result = await client.query<WorkspaceRow>(workspaceSelect, [companyId]);
  return result.rows[0] ? parseWorkspace(result.rows[0]) : null;
}

export async function loadCompanyInteractionProfile(
  requestedCompanyId?: string,
  providedActor?: SessionUser,
): Promise<CompanyInteractionWorkspace | null> {
  const actor = await actorOrSession(providedActor);
  const companyId = resolveInteractionCompanyId(actor, requestedCompanyId);
  if (isDemoMode()) return demoWorkspace(companyId);
  const result = await query<WorkspaceRow>(workspaceSelect, [companyId]);
  return result.rows[0] ? parseWorkspace(result.rows[0]) : null;
}

export async function ensureCompanyInteractionProfile(
  requestedCompanyId?: string,
  providedActor?: SessionUser,
): Promise<CompanyInteractionWorkspace | null> {
  const actor = await actorOrSession(providedActor);
  const companyId = resolveInteractionCompanyId(actor, requestedCompanyId);
  if (isDemoMode()) return demoWorkspace(companyId);

  return withAuditTransaction(
    { userId: actor.id, reason: "Interaction profile initialized" },
    async (client) => {
      await client.query(
        `INSERT INTO company_interaction_profiles(company_id)
         SELECT id FROM companies WHERE id=$1 AND active=true
         ON CONFLICT (company_id) DO NOTHING`,
        [companyId],
      );
      const workspace = await loadWorkspaceWithClient(client, companyId);
      if (!workspace) throw new Error("The selected company is unavailable or inactive.");
      return workspace;
    },
  );
}

export const getCompanyInteractionProfile = ensureCompanyInteractionProfile;

export async function regenerateCompanyInteractionRecommendation(
  requestedCompanyId: string | undefined,
  recommendationInput: InteractionRecommendation,
  providedActor?: SessionUser,
) {
  const actor = await actorOrSession(providedActor);
  const companyId = resolveInteractionCompanyId(actor, requestedCompanyId);
  const recommendation = InteractionRecommendationSchema.parse(recommendationInput);
  rejectDemoWrite();

  return withAuditTransaction(
    { userId: actor.id, reason: "Interaction recommendation regenerated" },
    async (client) => {
      const result = await client.query(
        `INSERT INTO company_interaction_profiles (
           company_id,ai_recommendation,ai_rationale,ai_recommended_at,ai_recommended_by
         )
         SELECT id,$2::jsonb,$3,now(),$4 FROM companies WHERE id=$1 AND active=true
         ON CONFLICT (company_id) DO UPDATE SET
           ai_recommendation=EXCLUDED.ai_recommendation,
           ai_rationale=EXCLUDED.ai_rationale,
           ai_recommended_at=EXCLUDED.ai_recommended_at,
           ai_recommended_by=EXCLUDED.ai_recommended_by,
           updated_at=now()`,
        [companyId, JSON.stringify(recommendation), recommendation.rationale, actor.id],
      );
      if (!result.rowCount) throw new Error("The selected company is unavailable or inactive.");
      return (await loadWorkspaceWithClient(client, companyId))!;
    },
  );
}

export async function saveCompanyInteractionOverride(
  requestedCompanyId: string | undefined,
  choiceInput: OwnerInteractionChoice,
  providedActor?: SessionUser,
) {
  const actor = await actorOrSession(providedActor);
  const companyId = resolveInteractionCompanyId(actor, requestedCompanyId);
  const choice = OwnerInteractionChoiceSchema.parse(choiceInput);
  rejectDemoWrite();

  return withAuditTransaction(
    { userId: actor.id, reason: "Interaction owner choice saved" },
    async (client) => {
      const result = await client.query(
        `INSERT INTO company_interaction_profiles (
           company_id,owner_override,owner_override_at,owner_override_by
         )
         SELECT id,$2::jsonb,now(),$3 FROM companies WHERE id=$1 AND active=true
         ON CONFLICT (company_id) DO UPDATE SET
           owner_override=EXCLUDED.owner_override,
           owner_override_at=EXCLUDED.owner_override_at,
           owner_override_by=EXCLUDED.owner_override_by,
           updated_at=now()`,
        [companyId, JSON.stringify(choice), actor.id],
      );
      if (!result.rowCount) throw new Error("The selected company is unavailable or inactive.");
      return (await loadWorkspaceWithClient(client, companyId))!;
    },
  );
}

export async function clearCompanyInteractionOverride(
  requestedCompanyId?: string,
  providedActor?: SessionUser,
) {
  const actor = await actorOrSession(providedActor);
  const companyId = resolveInteractionCompanyId(actor, requestedCompanyId);
  rejectDemoWrite();

  return withAuditTransaction(
    { userId: actor.id, reason: "Interaction owner choice reset to AI recommendation" },
    async (client) => {
      const result = await client.query(
        `UPDATE company_interaction_profiles
         SET owner_override=NULL,owner_override_at=NULL,owner_override_by=NULL,updated_at=now()
         WHERE company_id=$1
           AND EXISTS (SELECT 1 FROM companies WHERE id=$1 AND active=true)`,
        [companyId],
      );
      if (!result.rowCount) throw new Error("Interaction profile not found.");
      return (await loadWorkspaceWithClient(client, companyId))!;
    },
  );
}

async function publishSnapshot(
  client: PoolClient,
  input: {
    companyId: string;
    config: InteractionConfig;
    actorId: string;
    source: "PUBLISH" | "ROLLBACK";
    sourceRevisionId?: string;
  },
) {
  await client.query(
    `INSERT INTO company_interaction_profiles(company_id)
     SELECT id FROM companies WHERE id=$1 AND active=true
     ON CONFLICT (company_id) DO NOTHING`,
    [input.companyId],
  );
  const locked = await client.query(
    `SELECT 1
     FROM company_interaction_profiles profile
     JOIN companies company ON company.id=profile.company_id
     WHERE profile.company_id=$1 AND company.active=true
     FOR UPDATE OF profile`,
    [input.companyId],
  );
  if (!locked.rowCount) throw new Error("The selected company is unavailable or inactive.");

  const next = await client.query<{ revisionNumber: number }>(
    `SELECT COALESCE(max(revision_number),0)::int + 1 AS "revisionNumber"
     FROM interaction_revisions WHERE company_id=$1`,
    [input.companyId],
  );
  await client.query(
    "UPDATE interaction_revisions SET is_current=false WHERE company_id=$1 AND is_current=true",
    [input.companyId],
  );
  const revision = await client.query<RevisionRow>(
    `INSERT INTO interaction_revisions (
       company_id,revision_number,config,source,source_revision_id,is_current,created_by
     ) VALUES ($1,$2,$3::jsonb,$4,$5,true,$6)
     RETURNING id::text,company_id::text AS "companyId",
       revision_number AS "revisionNumber",config,source,
       source_revision_id::text AS "sourceRevisionId",is_current AS "isCurrent",
       NULL::text AS "createdByName",created_at AS "createdAt"`,
    [
      input.companyId,
      Number(next.rows[0]?.revisionNumber ?? 1),
      JSON.stringify(input.config),
      input.source,
      input.sourceRevisionId ?? null,
      input.actorId,
    ],
  );
  await client.query(
    `UPDATE company_interaction_profiles
     SET published_config=$2::jsonb,published_at=now(),published_by=$3,updated_at=now()
     WHERE company_id=$1`,
    [input.companyId, JSON.stringify(input.config), input.actorId],
  );
  return parseRevision(revision.rows[0]);
}

export async function publishCompanyInteraction(
  requestedCompanyId: string | undefined,
  configInput: InteractionConfig,
  providedActor?: SessionUser,
) {
  const actor = await actorOrSession(providedActor);
  const companyId = resolveInteractionCompanyId(actor, requestedCompanyId);
  const config = assertInteractionPublishable(configInput);
  rejectDemoWrite();
  return withAuditTransaction(
    { userId: actor.id, reason: "Interactive experience published" },
    (client) => publishSnapshot(client, {
      companyId,
      config,
      actorId: actor.id,
      source: "PUBLISH",
    }),
  );
}

export async function listCompanyInteractionRevisions(
  requestedCompanyId?: string,
  providedActor?: SessionUser,
) {
  const actor = await actorOrSession(providedActor);
  const companyId = resolveInteractionCompanyId(actor, requestedCompanyId);
  if (isDemoMode()) return [];
  const result = await query<RevisionRow>(
    `SELECT revision.id::text,revision.company_id::text AS "companyId",
       revision.revision_number AS "revisionNumber",revision.config,revision.source,
       revision.source_revision_id::text AS "sourceRevisionId",
       revision.is_current AS "isCurrent",creator.display_name AS "createdByName",
       revision.created_at AS "createdAt"
     FROM interaction_revisions revision
     JOIN companies company ON company.id=revision.company_id AND company.active=true
     LEFT JOIN users creator ON creator.id=revision.created_by
     WHERE revision.company_id=$1
     ORDER BY revision.revision_number DESC
     LIMIT 100`,
    [companyId],
  );
  return result.rows.map(parseRevision);
}

export async function rollbackCompanyInteraction(
  requestedCompanyId: string | undefined,
  sourceRevisionId: string,
  providedActor?: SessionUser,
) {
  const actor = await actorOrSession(providedActor);
  const companyId = resolveInteractionCompanyId(actor, requestedCompanyId);
  if (!UUID_PATTERN.test(sourceRevisionId)) throw new Error("Interaction revision not found.");
  rejectDemoWrite();

  return withAuditTransaction(
    { userId: actor.id, reason: "Interactive experience rolled back" },
    async (client) => {
      const source = await client.query<{ config: unknown }>(
        "SELECT config FROM interaction_revisions WHERE id=$1 AND company_id=$2",
        [sourceRevisionId, companyId],
      );
      if (!source.rows[0]) throw new Error("Interaction revision not found.");
      const config = assertInteractionPublishable(jsonValue(source.rows[0].config));
      return publishSnapshot(client, {
        companyId,
        config,
        actorId: actor.id,
        source: "ROLLBACK",
        sourceRevisionId,
      });
    },
  );
}

export async function listCompanyInteractionAssets(
  requestedCompanyId?: string,
  providedActor?: SessionUser,
) {
  const actor = await actorOrSession(providedActor);
  const companyId = resolveInteractionCompanyId(actor, requestedCompanyId);
  if (isDemoMode()) return [];
  const result = await query<AssetRow>(
    `SELECT asset.id::text,asset.company_id::text AS "companyId",asset.asset_key AS "assetKey",
       asset.display_name AS "displayName",asset.asset_type AS "assetType",
       asset.content_type AS "contentType",asset.storage_path AS "storagePath",
       asset.byte_size AS "byteSize",asset.sha256,asset.source_url AS "sourceUrl",
       asset.license_name AS "licenseName",asset.license_reference AS "licenseReference",
       asset.commercial_use_approved AS "commercialUseApproved",
       asset.attribution_required AS "attributionRequired",asset.attribution_text AS "attributionText",
       asset.active,asset.created_at AS "createdAt"
     FROM interaction_assets asset
     JOIN companies company ON company.id=asset.company_id AND company.active=true
     WHERE asset.company_id=$1 AND asset.active=true
     ORDER BY asset.display_name`,
    [companyId],
  );
  return result.rows.map(parseAsset);
}

export async function registerCompanyInteractionAsset(
  requestedCompanyId: string | undefined,
  assetInput: InteractionAssetInput,
  providedActor?: SessionUser,
) {
  const actor = await actorOrSession(providedActor);
  const companyId = resolveInteractionCompanyId(actor, requestedCompanyId);
  const asset = interactionAssetInputSchema.parse(assetInput);
  rejectDemoWrite();

  return withAuditTransaction(
    { userId: actor.id, reason: "Licensed interaction asset registered" },
    async (client) => {
      const result = await client.query<AssetRow>(
        `INSERT INTO interaction_assets (
           company_id,asset_key,display_name,asset_type,content_type,storage_path,
           byte_size,sha256,source_url,license_name,license_reference,
           commercial_use_approved,attribution_required,attribution_text,uploaded_by
         )
         SELECT id,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13,$14
         FROM companies WHERE id=$1 AND active=true
         ON CONFLICT (company_id,asset_key) DO UPDATE SET
           display_name=EXCLUDED.display_name,asset_type=EXCLUDED.asset_type,
           content_type=EXCLUDED.content_type,storage_path=EXCLUDED.storage_path,
           byte_size=EXCLUDED.byte_size,sha256=EXCLUDED.sha256,
           source_url=EXCLUDED.source_url,license_name=EXCLUDED.license_name,
           license_reference=EXCLUDED.license_reference,
           commercial_use_approved=true,
           attribution_required=EXCLUDED.attribution_required,
           attribution_text=EXCLUDED.attribution_text,active=true,
           uploaded_by=EXCLUDED.uploaded_by,updated_at=now()
         RETURNING id::text,company_id::text AS "companyId",asset_key AS "assetKey",
           display_name AS "displayName",asset_type AS "assetType",
           content_type AS "contentType",storage_path AS "storagePath",
           byte_size AS "byteSize",sha256,source_url AS "sourceUrl",
           license_name AS "licenseName",license_reference AS "licenseReference",
           commercial_use_approved AS "commercialUseApproved",
           attribution_required AS "attributionRequired",attribution_text AS "attributionText",
           active,created_at AS "createdAt"`,
        [
          companyId,
          asset.assetKey,
          asset.displayName,
          asset.assetType,
          asset.contentType,
          asset.storagePath,
          asset.byteSize,
          asset.sha256,
          asset.sourceUrl,
          asset.licenseName,
          asset.licenseReference,
          asset.attributionRequired,
          asset.attributionText ?? null,
          actor.id,
        ],
      );
      if (!result.rows[0]) throw new Error("The selected company is unavailable or inactive.");
      return parseAsset(result.rows[0]);
    },
  );
}

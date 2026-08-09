import { createHash, randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import sharp, { type Metadata } from "sharp";
import { z } from "zod";
import type { AuthenticatedSessionUser, SessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { uploadedContentMatchesMime } from "./file-content";
import { canAccess } from "./permissions";
import {
  readPersistentProfileImage,
  removePersistentUpload,
  storePersistentProfileImageVariant,
} from "./persistent-files";
import { lockAuthorizedUserTarget } from "./user-isolation";

export const PROFILE_IMAGE_MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const PROFILE_IMAGE_MIN_DIMENSION = 64;
export const PROFILE_IMAGE_MAX_DIMENSION = 4096;
export const PROFILE_IMAGE_SIZES = [64, 128, 256] as const;
const MAX_INPUT_PIXELS = PROFILE_IMAGE_MAX_DIMENSION ** 2;
const PROFILE_PROCESSING_VERSION = "axora-profile-image-v1";
const MIME_BY_FORMAT = new Map([
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
] as const);

export type ProfileImageErrorCode =
  | "size" | "type" | "decode" | "dimensions" | "transparent"
  | "processing" | "storage" | "interrupted" | "unavailable";

export class ProfileImageError extends Error {
  constructor(public readonly code: ProfileImageErrorCode) {
    super(code);
    this.name = "ProfileImageError";
  }
}

export const profileCropSchema = z.object({
  focalX: z.coerce.number().min(0).max(100).default(50),
  focalY: z.coerce.number().min(0).max(100).default(50),
  zoom: z.coerce.number().min(1).max(3).default(1),
}).strict();

export interface PreparedProfileImage {
  sourceContentType: "image/jpeg" | "image/png" | "image/webp";
  sourceWidth: number;
  sourceHeight: number;
  focalX: number;
  focalY: number;
  zoom: number;
  sha256: string;
  variants: Record<(typeof PROFILE_IMAGE_SIZES)[number], Buffer>;
}

export interface ProfileImagePolicy {
  deliveryAgentPhotoRequired: boolean;
  retiredVersionRetentionDays: number;
  companyId?: string;
  companyName?: string;
  companyPhotoDisplayEnabled?: boolean;
}

interface JsonRow extends QueryResultRow { value: unknown }
interface ImageFileRow extends QueryResultRow {
  versionId?: string | null;
  storagePath?: string | null;
  legacyContent?: Buffer | null;
  contentType: string;
  sha256: string;
}

interface DemoImage {
  versionId: string;
  sha256: string;
  variants: PreparedProfileImage["variants"];
}

declare global {
  var __axoraDemoProfileImages: Map<string, DemoImage> | undefined;
  var __axoraDemoProfilePolicies: Map<string, boolean> | undefined;
}

function demoImages() {
  return global.__axoraDemoProfileImages ??= new Map();
}

function demoPolicies() {
  return global.__axoraDemoProfilePolicies ??= new Map();
}

function assignmentId(actor: SessionUser) {
  if (!actor.roleAssignmentId) throw new ProfileImageError("unavailable");
  return actor.roleAssignmentId;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export async function prepareProfileImage(
  file: File,
  cropInput: z.input<typeof profileCropSchema> = {},
): Promise<PreparedProfileImage> {
  if (!(file instanceof File) || file.size < 1
    || file.size > PROFILE_IMAGE_MAX_INPUT_BYTES) {
    throw new ProfileImageError("size");
  }
  const claimedType = file.type as PreparedProfileImage["sourceContentType"];
  if (![...MIME_BY_FORMAT.values()].includes(claimedType)) {
    throw new ProfileImageError("type");
  }
  const source = Buffer.from(await file.arrayBuffer());
  if (source.length !== file.size
    || !uploadedContentMatchesMime(claimedType, source)) {
    throw new ProfileImageError("type");
  }
  const crop = profileCropSchema.parse(cropInput);
  let metadata: Metadata;
  try {
    metadata = await sharp(source, {
      animated: false,
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
  } catch {
    throw new ProfileImageError("decode");
  }
  const detectedType = metadata.format
    ? MIME_BY_FORMAT.get(metadata.format as "jpeg" | "png" | "webp")
    : undefined;
  if (!detectedType || detectedType !== claimedType || (metadata.pages ?? 1) !== 1) {
    throw new ProfileImageError("type");
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < PROFILE_IMAGE_MIN_DIMENSION || height < PROFILE_IMAGE_MIN_DIMENSION
    || width > PROFILE_IMAGE_MAX_DIMENSION || height > PROFILE_IMAGE_MAX_DIMENSION) {
    throw new ProfileImageError("dimensions");
  }
  if (metadata.hasAlpha) {
    try {
      const stats = await sharp(source, {
        animated: false,
        failOn: "error",
        limitInputPixels: MAX_INPUT_PIXELS,
      }).ensureAlpha().stats();
      if ((stats.channels[3]?.mean ?? 255) < 25) {
        throw new ProfileImageError("transparent");
      }
    } catch (error) {
      if (error instanceof ProfileImageError) throw error;
      throw new ProfileImageError("decode");
    }
  }

  try {
    const sanitized = await sharp(source, {
      animated: false,
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .flatten({ background: "#f1f5f9" })
      .webp({ quality: 92, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    const orientedWidth = sanitized.info.width;
    const orientedHeight = sanitized.info.height;
    const cropSize = Math.max(
      1,
      Math.floor(Math.min(orientedWidth, orientedHeight) / crop.zoom),
    );
    const centerX = orientedWidth * crop.focalX / 100;
    const centerY = orientedHeight * crop.focalY / 100;
    const left = clamp(
      Math.round(centerX - cropSize / 2),
      0,
      orientedWidth - cropSize,
    );
    const top = clamp(
      Math.round(centerY - cropSize / 2),
      0,
      orientedHeight - cropSize,
    );
    const variants = {} as PreparedProfileImage["variants"];
    for (const size of PROFILE_IMAGE_SIZES) {
      variants[size] = await sharp(sanitized.data, {
        animated: false,
        failOn: "error",
      })
        .extract({ left, top, width: cropSize, height: cropSize })
        .resize(size, size, { fit: "fill" })
        .webp({ quality: size === 256 ? 84 : 80, effort: 5 })
        .toBuffer();
    }
    return {
      sourceContentType: detectedType,
      sourceWidth: orientedWidth,
      sourceHeight: orientedHeight,
      focalX: crop.focalX,
      focalY: crop.focalY,
      zoom: crop.zoom,
      sha256: createHash("sha256").update(PROFILE_PROCESSING_VERSION).update(variants[256]).digest("hex"),
      variants,
    };
  } catch (error) {
    if (error instanceof ProfileImageError) throw error;
    throw new ProfileImageError("processing");
  }
}

export async function saveMyProfileImage(
  file: File,
  actor: SessionUser,
  crop: z.input<typeof profileCropSchema> = {},
) {
  const prepared = await prepareProfileImage(file, crop);
  const versionId = randomUUID();
  if (isDemoMode()) {
    const current = demoImages().get(actor.id);
    if (current?.sha256 === prepared.sha256) {
      return { status: "UNCHANGED" as const, versionId: current.versionId };
    }
    demoImages().set(actor.id, {
      versionId,
      sha256: prepared.sha256,
      variants: prepared.variants,
    });
    return { status: "ACTIVATED" as const, versionId };
  }

  const paths: string[] = [];
  try {
    for (const size of PROFILE_IMAGE_SIZES) {
      paths.push(await storePersistentProfileImageVariant({
        userId: actor.id,
        versionId,
        bytes: prepared.variants[size],
      }));
    }
  } catch {
    await Promise.all(paths.map((path) => removePersistentUpload(path)));
    throw new ProfileImageError("storage");
  }

  try {
    const result = await withAuditTransaction(
      { actor, reason: "Processed profile image activated" },
      (client) => client.query<JsonRow>(`
        SELECT public.axora_activate_profile_image(
          $1,$2,$1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
        ) AS value
      `, [
        actor.id,
        assignmentId(actor),
        versionId,
        prepared.sourceContentType,
        prepared.sourceWidth,
        prepared.sourceHeight,
        prepared.focalX,
        prepared.focalY,
        prepared.zoom,
        prepared.sha256,
        paths[0],
        paths[1],
        paths[2],
        new Date(),
      ]),
    );
    const parsed = z.object({
      status: z.enum(["ACTIVATED", "UNCHANGED"]),
      versionId: z.string().uuid(),
    }).safeParse(result.rows[0]?.value);
    if (!parsed.success) throw new ProfileImageError("unavailable");
    if (parsed.data.status === "UNCHANGED") {
      await Promise.all(paths.map((path) => removePersistentUpload(path)));
    }
    return parsed.data;
  } catch (error) {
    await Promise.all(paths.map((path) => removePersistentUpload(path)));
    if (error instanceof ProfileImageError) throw error;
    throw new ProfileImageError("unavailable");
  }
}

export async function removeMyProfileImage(actor: SessionUser) {
  if (isDemoMode()) {
    demoImages().delete(actor.id);
    return;
  }
  const result = await withAuditTransaction(
    { actor, reason: "Profile image removed" },
    (client) => client.query<{ removed: boolean }>(`
      SELECT public.axora_remove_profile_image(
        $1,$2,$1,'REMOVED_BY_USER',$3
      ) AS removed
    `, [actor.id, assignmentId(actor), new Date()]),
  );
  if (result.rows[0]?.removed !== true) throw new ProfileImageError("unavailable");
}

export async function deactivateAuthorizedProfileImage(
  targetUserId: string,
  actor: AuthenticatedSessionUser,
) {
  if (!canAccess(actor, "manage_users")) throw new ProfileImageError("unavailable");
  if (isDemoMode()) {
    demoImages().delete(targetUserId);
    return;
  }
  const removed = await withAuditTransaction(
    { actor, reason: "Profile image deactivated by authorized administrator" },
    async (client) => {
      await lockAuthorizedUserTarget(actor, targetUserId, "user.edit", client);
      return client.query<{ removed: boolean }>(`
        SELECT public.axora_remove_profile_image(
          $1,$2,$3,'ADMINISTRATOR_DEACTIVATED',$4
        ) AS removed
      `, [actor.id, assignmentId(actor), targetUserId, new Date()]);
    },
  );
  if (removed.rows[0]?.removed !== true) throw new ProfileImageError("unavailable");
}

export function demoProfileImageState(userId: string) {
  const image = demoImages().get(userId);
  return image ? { available: true, versionId: image.versionId } : {
    available: false,
    versionId: undefined,
  };
}

export async function loadAuthorizedProfileImage(input: {
  actor: SessionUser;
  targetUserId: string;
  size: (typeof PROFILE_IMAGE_SIZES)[number];
  deliveryJobId?: string;
}) {
  if (!z.string().uuid().safeParse(input.targetUserId).success
    || (input.deliveryJobId
      && !z.string().uuid().safeParse(input.deliveryJobId).success)) return null;
  if (isDemoMode()) {
    const authorized = input.actor.id === input.targetUserId
      || canAccess(input.actor, "manage_users")
      || Boolean(input.deliveryJobId && input.actor.accountKind === "COMPANY");
    const image = authorized ? demoImages().get(input.targetUserId) : undefined;
    return image ? {
      bytes: image.variants[input.size],
      contentType: "image/webp",
      sha256: image.sha256,
      versionId: image.versionId,
    } : null;
  }
  if (!input.actor.roleAssignmentId) return null;
  const result = await query<ImageFileRow>(`
    SELECT version_id::text AS "versionId",storage_path AS "storagePath",
      legacy_content AS "legacyContent",content_type AS "contentType",sha256
    FROM public.axora_profile_image_file($1,$2,$3,$4,$5,$6)
  `, [
    input.actor.id,
    input.actor.roleAssignmentId,
    input.targetUserId,
    input.deliveryJobId ?? null,
    input.size,
    new Date(),
  ]);
  const image = result.rows[0];
  if (!image) return null;
  const bytes = image.storagePath
    ? await readPersistentProfileImage(image.storagePath)
    : image.legacyContent;
  if (!bytes) return null;
  return {
    bytes,
    contentType: image.contentType,
    sha256: image.sha256,
    versionId: image.versionId ?? image.sha256,
  };
}

const policySchema = z.object({
  deliveryAgentPhotoRequired: z.boolean(),
  retiredVersionRetentionDays: z.number().int().min(1).max(365),
  companyId: z.string().uuid().nullish(),
  companyName: z.string().nullish(),
  companyPhotoDisplayEnabled: z.boolean().nullish(),
});

export async function getProfileImagePolicy(
  actor: SessionUser,
  companyId?: string,
): Promise<ProfileImagePolicy> {
  if (isDemoMode()) return {
    deliveryAgentPhotoRequired: demoPolicies().get("delivery-required") ?? false,
    retiredVersionRetentionDays: 30,
    ...(companyId ? {
      companyId,
      companyName: "Demo company",
      companyPhotoDisplayEnabled: demoPolicies().get(companyId) ?? true,
    } : {}),
  };
  const result = await query<JsonRow>(`
    SELECT public.axora_profile_image_policy($1,$2,$3,$4) AS value
  `, [actor.id, assignmentId(actor), companyId ?? null, new Date()]);
  const parsed = policySchema.safeParse(result.rows[0]?.value);
  if (!parsed.success) throw new ProfileImageError("unavailable");
  return {
    deliveryAgentPhotoRequired: parsed.data.deliveryAgentPhotoRequired,
    retiredVersionRetentionDays: parsed.data.retiredVersionRetentionDays,
    ...(parsed.data.companyId ? { companyId: parsed.data.companyId } : {}),
    ...(parsed.data.companyName ? { companyName: parsed.data.companyName } : {}),
    ...(parsed.data.companyPhotoDisplayEnabled !== null
      && parsed.data.companyPhotoDisplayEnabled !== undefined
      ? { companyPhotoDisplayEnabled: parsed.data.companyPhotoDisplayEnabled }
      : {}),
  };
}

export async function updateProfileImagePolicy(input: {
  companyId?: string;
  deliveryAgentPhotoRequired?: boolean;
  companyPhotoDisplayEnabled?: boolean;
}, actor: AuthenticatedSessionUser) {
  if (!canAccess(actor, "manage_settings")) throw new ProfileImageError("unavailable");
  if (isDemoMode()) {
    if (input.companyId) {
      demoPolicies().set(input.companyId, input.companyPhotoDisplayEnabled ?? true);
    } else {
      demoPolicies().set("delivery-required", input.deliveryAgentPhotoRequired ?? false);
    }
    return;
  }
  const result = await withAuditTransaction(
    { actor, reason: "Profile image policy updated" },
    (client) => client.query<JsonRow>(`
      SELECT public.axora_update_profile_image_policy(
        $1,$2,$3,$4,$5,$6
      ) AS value
    `, [
      actor.id,
      assignmentId(actor),
      input.companyId ?? null,
      input.deliveryAgentPhotoRequired ?? null,
      input.companyPhotoDisplayEnabled ?? null,
      new Date(),
    ]),
  );
  if (!policySchema.safeParse(result.rows[0]?.value).success) {
    throw new ProfileImageError("unavailable");
  }
}

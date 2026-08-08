import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import type { SessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { isSupportedLocale, type SupportedLocale } from "./i18n";
import {
  hasCompletedRequiredProfile,
  REQUIRED_POLICY_VERSION,
} from "./onboarding-policy";

const PROFILE_IMAGE_MAX_BYTES = 1024 * 1024;

const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(200),
  jobTitle: z.string().trim().max(160),
  phone: z.string().trim().max(40),
  preferredLocale: z.string().refine(isSupportedLocale, "Choose a supported language."),
  timezone: z.string().trim().min(1).max(80),
  emailNotifications: z.boolean(),
  inAppNotifications: z.boolean(),
  policyAccepted: z.literal(true),
});

export interface MyProfile {
  userId: string;
  email: string;
  displayName: string;
  jobTitle: string;
  phone: string;
  preferredLocale: SupportedLocale;
  timezone: string;
  avatarAvailable: boolean;
  emailNotifications: boolean;
  inAppNotifications: boolean;
  profileCompletedAt?: string;
  requiredPolicyVersion?: string;
  requiredPolicyAcceptedAt?: string;
  accountStatus: "INVITED" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
}

export async function getMyProfile(actor: SessionUser): Promise<MyProfile> {
  if (isDemoMode()) {
    return {
      userId: actor.id,
      email: actor.email,
      displayName: actor.name,
      jobTitle: "",
      phone: "",
      preferredLocale: actor.preferredLocale ?? "en",
      timezone: actor.timezone ?? "Asia/Kuala_Lumpur",
      avatarAvailable: false,
      emailNotifications: true,
      inAppNotifications: true,
      profileCompletedAt: new Date().toISOString(),
      requiredPolicyVersion: REQUIRED_POLICY_VERSION,
      requiredPolicyAcceptedAt: new Date().toISOString(),
      accountStatus: "ACTIVE",
    };
  }
  const result = await query<MyProfile>(`
    SELECT account.id::text AS "userId",account.email,
      profile.display_name AS "displayName",profile.job_title AS "jobTitle",
      profile.phone,profile.preferred_locale AS "preferredLocale",
      profile.timezone,(profile.avatar_content IS NOT NULL) AS "avatarAvailable",
      profile.notification_email_enabled AS "emailNotifications",
      profile.notification_in_app_enabled AS "inAppNotifications",
      profile.profile_completed_at::text AS "profileCompletedAt",
      profile.required_policy_version AS "requiredPolicyVersion",
      profile.required_policy_accepted_at::text AS "requiredPolicyAcceptedAt",
      account.account_status AS "accountStatus"
    FROM users account
    JOIN user_profiles profile ON profile.user_id=account.id
    WHERE account.id=$1
  `, [actor.id]);
  if (!result.rows[0]) throw new Error("Profile not found.");
  return result.rows[0];
}

export function myProfileMeetsRequiredOnboarding(profile: MyProfile) {
  return hasCompletedRequiredProfile(profile);
}

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export async function completeMyProfile(input: z.input<typeof profileSchema>, actor: SessionUser) {
  const safe = profileSchema.parse(input);
  if (!validTimezone(safe.timezone)) throw new Error("Choose a valid timezone.");
  if (isDemoMode()) return;
  await withAuditTransaction({ actor, reason: "Profile completed" }, async (client) => {
    await client.query(`
      UPDATE user_profiles SET
        display_name=$2,job_title=$3,phone=$4,preferred_locale=$5,timezone=$6,
        notification_email_enabled=$7,notification_in_app_enabled=$8,
        required_policy_version=$9,
        required_policy_accepted_at=CASE
          WHEN required_policy_version IS DISTINCT FROM $9 THEN now()
          ELSE COALESCE(required_policy_accepted_at,now())
        END,
        profile_completed_at=COALESCE(profile_completed_at,now()),updated_at=now()
      WHERE user_id=$1
    `, [
      actor.id,
      safe.displayName,
      safe.jobTitle,
      safe.phone,
      safe.preferredLocale,
      safe.timezone,
      safe.emailNotifications,
      safe.inAppNotifications,
      REQUIRED_POLICY_VERSION,
    ]);
    await client.query("UPDATE users SET display_name=$2 WHERE id=$1", [actor.id, safe.displayName]);
    await client.query(`
      INSERT INTO onboarding_progress(user_id,profile_stage_status,started_at,current_step_key,updated_at)
      VALUES ($1,'COMPLETED',now(),'tutorial',now())
      ON CONFLICT(user_id) DO UPDATE SET
        profile_stage_status='COMPLETED',started_at=COALESCE(onboarding_progress.started_at,now()),
        current_step_key='tutorial',updated_at=now()
    `, [actor.id]);
  });
}

export async function saveMyProfileImage(file: File, actor: SessionUser) {
  if (file.size < 1 || file.size > PROFILE_IMAGE_MAX_BYTES) throw new Error("Profile images must be smaller than 1 MB.");
  const source = Buffer.from(await file.arrayBuffer());
  const image = sharp(source, { animated: false, failOn: "warning", limitInputPixels: 8_388_608 });
  const metadata = await image.metadata();
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages ?? 1) !== 1) {
    throw new Error("Use a PNG, JPEG, or WebP profile image.");
  }
  const output = await image.rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
  const sha256 = createHash("sha256").update(output).digest("hex");
  if (isDemoMode()) return;
  await withAuditTransaction({ actor, reason: "Profile image updated" }, (client) => client.query(`
    UPDATE user_profiles SET
      avatar_file_name='profile.webp',avatar_content_type='image/webp',
      avatar_content=$2,avatar_sha256=$3
    WHERE user_id=$1
  `, [actor.id, output, sha256]));
}

export async function removeMyProfileImage(actor: SessionUser) {
  if (isDemoMode()) return;
  await withAuditTransaction({ actor, reason: "Profile image removed" }, (client) => client.query(`
    UPDATE user_profiles SET
      avatar_file_name=NULL,avatar_content_type=NULL,avatar_content=NULL,avatar_sha256=NULL,
      updated_at=now()
    WHERE user_id=$1
  `, [actor.id]));
}

export async function updateMyPreferredLocale(locale: SupportedLocale, actor: SessionUser) {
  if (!isSupportedLocale(locale)) throw new Error("Choose a supported language.");
  if (isDemoMode()) return;
  await withAuditTransaction({ actor, reason: "Preferred language updated" }, (client) => client.query(`
    UPDATE user_profiles SET preferred_locale=$2,updated_at=now() WHERE user_id=$1
  `, [actor.id, locale]));
}

import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import { withAuditTransaction } from "./db";
import { isSupportedLocale } from "./i18n";
import { lockAuthorizedUserTarget } from "./user-isolation";

const profileUpdateSchema = z.object({
  targetUserId: z.string().uuid(),
  displayName: z.string().trim().min(2).max(200),
  jobTitle: z.string().trim().max(160),
  preferredLocale: z.string().refine(isSupportedLocale, "Choose a supported language."),
}).strict();

export class ExistingUserManagementUnavailableError extends Error {
  constructor() {
    super("The requested user-management change could not be completed.");
    this.name = "ExistingUserManagementUnavailableError";
  }
}

export async function updateManagedUserProfile(
  actor: AuthenticatedSessionUser,
  input: z.input<typeof profileUpdateSchema>,
) {
  const parsed = profileUpdateSchema.parse(input);
  if (parsed.targetUserId === actor.id) {
    throw new ExistingUserManagementUnavailableError();
  }

  try {
    await withAuditTransaction(
      { actor, reason: "Managed user profile updated" },
      async (client) => {
        await lockAuthorizedUserTarget(
          actor,
          parsed.targetUserId,
          "user.edit",
          client,
        );
        const profile = await client.query(
          `UPDATE public.user_profiles
           SET display_name=$2,job_title=$3,preferred_locale=$4,updated_at=now()
           WHERE user_id=$1
           RETURNING user_id`,
          [
            parsed.targetUserId,
            parsed.displayName,
            parsed.jobTitle,
            parsed.preferredLocale,
          ],
        );
        if (profile.rowCount !== 1) {
          throw new ExistingUserManagementUnavailableError();
        }
        await client.query(
          `UPDATE public.users SET display_name=$2 WHERE id=$1`,
          [parsed.targetUserId, parsed.displayName],
        );
      },
    );
  } catch (error) {
    if (error instanceof z.ZodError
      || error instanceof ExistingUserManagementUnavailableError) {
      throw error;
    }
    throw new ExistingUserManagementUnavailableError();
  }
}

export const existingUserManagementInternals = { profileUpdateSchema };

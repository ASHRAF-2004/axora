import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { canAccess } from "./permissions";
import {
  isAccountKind,
  isRoleScopeType,
  isUserRole,
  type UserRecord,
} from "./types";
import {
  listUsers as listLegacyUsers,
  setUserActive as setLegacyUserActive,
} from "./users";

const uuidSchema = z.string().uuid();
const optionalUuid = z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  uuidSchema.optional(),
);
const optionalText = z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  z.string().optional(),
);
const optionalDate = z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  z.coerce.date().optional(),
);

const userDirectoryRowSchema = z.object({
  id: uuidSchema,
  email: z.email(),
  displayName: z.string().trim().min(1).max(300),
  role: z.string().refine(isUserRole, "Unknown account role"),
  active: z.boolean(),
  avatarAvailable: z.boolean(),
  isOwner: z.boolean(),
  accountKind: z.string().refine(isAccountKind, "Unknown account kind"),
  accountStatus: z.enum(["INVITED", "ACTIVE", "SUSPENDED", "DEACTIVATED"]),
  scopeType: z.string().refine(isRoleScopeType, "Unknown scope type"),
  companyId: optionalUuid,
  companyName: optionalText,
  branchId: optionalUuid,
  branchName: optionalText,
  departmentId: optionalUuid,
  departmentName: optionalText,
  supplierId: optionalUuid,
  supplierName: optionalText,
  jobTitle: optionalText,
  accountSetupCompletedAt: optionalDate,
  accountSetupDeliveryStatus: z.preprocess(
    (value) => value === null || value === "" ? undefined : value,
    z.enum([
      "PENDING", "SENDING", "SENT", "FAILED", "DISABLED",
      "UNCERTAIN", "CANCELLED",
    ]).optional(),
  ),
  accountSetupExpiresAt: optionalDate,
  accountSetupSentAt: optionalDate,
  accountSetupDeliveryAttemptedAt: optionalDate,
  lastLoginAt: optionalDate,
  createdAt: z.coerce.date(),
}).strict();

const userTargetSchema = z.object({
  capturedAt: z.coerce.date(),
  permission: z.enum([
    "user.view", "user.edit", "user.deactivate", "user.invite",
    "user.permission.manage",
  ]),
  userId: uuidSchema,
  active: z.boolean(),
  isOwner: z.boolean(),
  accountKind: z.string().refine(isAccountKind),
  accountStatus: z.enum(["INVITED", "ACTIVE", "SUSPENDED", "DEACTIVATED"]),
  setupCompleted: z.boolean(),
  roleAssignmentId: uuidSchema,
  role: z.string().refine(isUserRole),
  scope: z.object({
    type: z.string().refine(isRoleScopeType),
    companyId: optionalUuid,
    branchId: optionalUuid,
    departmentId: optionalUuid,
    supplierId: optionalUuid,
  }).strict(),
}).strict();

interface UserDirectoryRow extends QueryResultRow {
  id: string;
  email: string;
  displayName: string;
  role: string;
  active: boolean;
  avatarAvailable: boolean;
  isOwner: boolean;
  accountKind: string;
  accountStatus: string;
  scopeType: string;
  companyId?: string | null;
  companyName?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  jobTitle?: string | null;
  accountSetupCompletedAt?: string | Date | null;
  accountSetupDeliveryStatus?: string | null;
  accountSetupExpiresAt?: string | Date | null;
  accountSetupSentAt?: string | Date | null;
  accountSetupDeliveryAttemptedAt?: string | Date | null;
  lastLoginAt?: string | Date | null;
  createdAt: string | Date;
}

interface TargetRow extends QueryResultRow {
  snapshot: unknown;
}

interface RemovalRow extends QueryResultRow {
  snapshot: unknown;
}

const removalSchema = z.object({
  removed: z.boolean(),
  userId: uuidSchema,
  authVersion: z.coerce.number().int().positive(),
  revokedAssignments: z.coerce.number().int().nonnegative(),
  revokedInvitations: z.coerce.number().int().nonnegative(),
  disabledOverrides: z.coerce.number().int().nonnegative(),
  cancelledWorkflowEmails: z.coerce.number().int().nonnegative(),
}).strict();

export class UserAccessUnavailableError extends Error {
  constructor() {
    super("The requested user account is unavailable.");
    this.name = "UserAccessUnavailableError";
  }
}

function requireAssignment(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) throw new UserAccessUnavailableError();
  return actor.roleAssignmentId;
}

function serializedDate(value?: Date) {
  return value?.toISOString();
}

function toUserRecord(row: UserDirectoryRow): UserRecord {
  const parsed = userDirectoryRowSchema.safeParse(row);
  if (!parsed.success) throw new UserAccessUnavailableError();
  const value = parsed.data;
  return {
    id: value.id,
    email: value.email,
    displayName: value.displayName,
    role: value.role,
    active: value.active,
    avatarAvailable: value.avatarAvailable,
    isOwner: value.isOwner,
    companyId: value.companyId,
    companyName: value.companyName,
    branchId: value.branchId,
    branchName: value.branchName,
    departmentId: value.departmentId,
    departmentName: value.departmentName,
    supplierId: value.supplierId,
    supplierName: value.supplierName,
    jobTitle: value.jobTitle,
    accountKind: value.accountKind,
    scopeType: value.scopeType,
    accountStatus: value.accountStatus,
    accountSetupCompletedAt: serializedDate(value.accountSetupCompletedAt),
    accountSetupDeliveryStatus: value.accountSetupDeliveryStatus,
    accountSetupExpiresAt: serializedDate(value.accountSetupExpiresAt),
    accountSetupSentAt: serializedDate(value.accountSetupSentAt),
    accountSetupDeliveryAttemptedAt: serializedDate(
      value.accountSetupDeliveryAttemptedAt,
    ),
    lastLoginAt: serializedDate(value.lastLoginAt),
    createdAt: value.createdAt.toISOString(),
  };
}

export async function listAuthorizedUsers(
  actor: AuthenticatedSessionUser,
): Promise<UserRecord[]> {
  if (!canAccess(actor, "manage_users")) {
    throw new UserAccessUnavailableError();
  }
  if (isDemoMode()) return listLegacyUsers(actor);

  try {
    const result = await query<UserDirectoryRow>(`
      SELECT
        user_id::text AS id,
        email,
        display_name AS "displayName",
        role_key AS role,
        active,
        public.axora_profile_image_available($1,$2,user_id,$3) AS "avatarAvailable",
        is_owner AS "isOwner",
        account_kind AS "accountKind",
        account_status AS "accountStatus",
        scope_type AS "scopeType",
        company_id::text AS "companyId",
        company_name AS "companyName",
        branch_id::text AS "branchId",
        branch_name AS "branchName",
        department_id::text AS "departmentId",
        department_name AS "departmentName",
        supplier_id::text AS "supplierId",
        supplier_name AS "supplierName",
        job_title AS "jobTitle",
        account_setup_completed_at AS "accountSetupCompletedAt",
        account_setup_delivery_status AS "accountSetupDeliveryStatus",
        account_setup_expires_at AS "accountSetupExpiresAt",
        account_setup_sent_at AS "accountSetupSentAt",
        account_setup_delivery_attempted_at
          AS "accountSetupDeliveryAttemptedAt",
        last_login_at AS "lastLoginAt",
        created_at AS "createdAt"
      FROM public.axora_user_directory_rows($1,$2,$3)
    `, [actor.id, requireAssignment(actor), new Date()]);
    return result.rows.map(toUserRecord);
  } catch (error) {
    if (error instanceof UserAccessUnavailableError) throw error;
    throw new UserAccessUnavailableError();
  }
}

export async function lockAuthorizedUserTarget(
  actor: AuthenticatedSessionUser,
  targetUserId: string,
  permission: "user.view" | "user.edit" | "user.deactivate"
    | "user.invite" | "user.permission.manage",
  client?: import("pg").PoolClient,
  capturedAt = new Date(),
) {
  if (!uuidSchema.safeParse(targetUserId).success
    || !Number.isFinite(capturedAt.getTime())) {
    throw new UserAccessUnavailableError();
  }
  const execute = client
    ? client.query.bind(client)
    : query;
  try {
    const result = await execute<TargetRow>(`
      SELECT public.axora_lock_user_target_access(
        $1,$2,$3,$4,$5
      ) AS snapshot
    `, [
      actor.id,
      requireAssignment(actor),
      permission,
      targetUserId,
      capturedAt,
    ]);
    const parsed = userTargetSchema.safeParse(result.rows[0]?.snapshot);
    if (!parsed.success
      || parsed.data.capturedAt.getTime() !== capturedAt.getTime()
      || parsed.data.permission !== permission
      || parsed.data.userId !== targetUserId) {
      throw new UserAccessUnavailableError();
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof UserAccessUnavailableError) throw error;
    throw new UserAccessUnavailableError();
  }
}

export async function setAuthorizedUserActive(
  targetUserId: string,
  active: boolean,
  actor: AuthenticatedSessionUser,
) {
  if (isDemoMode()) return setLegacyUserActive(targetUserId, active, actor);
  if (!canAccess(actor, "manage_users")) {
    throw new UserAccessUnavailableError();
  }
  if (!active && targetUserId === actor.id) {
    throw new Error("You cannot deactivate your own account.");
  }

  await withAuditTransaction({
    actor,
    reason: active ? "Account activated" : "Account deactivated",
  }, async (client) => {
    const target = await lockAuthorizedUserTarget(
      actor,
      targetUserId,
      "user.deactivate",
      client,
    );
    if (active && target.accountStatus === "DEACTIVATED") {
      throw new UserAccessUnavailableError();
    }
    if (!active && target.active) {
      await client.query(`
        UPDATE public.account_setup_invitations
        SET revoked_at=now(),
            delivery_status=CASE
              WHEN delivery_status IN ('PENDING','SENDING')
                THEN 'CANCELLED'
              ELSE delivery_status
            END
        WHERE user_id=$1
          AND consumed_at IS NULL
          AND revoked_at IS NULL
      `, [targetUserId]);
    }
    await client.query(`
      UPDATE public.users
      SET active=$2,
          account_status=CASE
            WHEN $2 AND account_setup_completed_at IS NOT NULL THEN 'ACTIVE'
            WHEN $2 THEN 'INVITED'
            ELSE 'SUSPENDED'
          END,
          auth_version=CASE
            WHEN active IS DISTINCT FROM $2 THEN auth_version+1
            ELSE auth_version
          END
      WHERE id=$1
    `, [targetUserId, active]);
  });
}

export async function removeAuthorizedUser(
  targetUserId: string,
  reason: string,
  actor: AuthenticatedSessionUser,
) {
  const safeTargetUserId = uuidSchema.parse(targetUserId);
  const safeReason = z.string().trim().min(3).max(500)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value))
    .parse(reason);
  if (!actor.isOwner || safeTargetUserId === actor.id) {
    throw new UserAccessUnavailableError();
  }
  if (isDemoMode()) {
    await setLegacyUserActive(safeTargetUserId, false, actor);
    return;
  }

  await withAuditTransaction({ actor, reason: safeReason }, async (client) => {
    const result = await client.query<RemovalRow>(`
      SELECT public.axora_remove_user_account($1,$2,$3,$4,$5) AS snapshot
    `, [
      actor.id,
      requireAssignment(actor),
      safeTargetUserId,
      safeReason,
      new Date(),
    ]);
    const parsed = removalSchema.safeParse(result.rows[0]?.snapshot);
    if (!parsed.success || parsed.data.userId !== safeTargetUserId
      || !parsed.data.removed) {
      throw new UserAccessUnavailableError();
    }
  });
}

export const userIsolationInternals = {
  toUserRecord,
  userDirectoryRowSchema,
  userTargetSchema,
  removalSchema,
};

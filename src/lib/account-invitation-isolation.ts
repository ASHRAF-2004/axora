import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { SessionUser } from "./auth";
import {
  isAccountKind,
  isRoleScopeType,
  isUserRole,
} from "./types";
import type { ResolvedUserCreation } from "./users";
import { accountSetupDeliveryStatuses } from "./account-invitation-eligibility";

const uuidSchema = z.string().uuid();
const optionalUuid = z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  uuidSchema.optional(),
);
const optionalText = z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  z.string().trim().min(1).max(300).optional(),
);
const optionalDate = z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  z.coerce.date().optional(),
);

const scopeSchema = z.object({
  type: z.string().refine(isRoleScopeType),
  companyId: optionalUuid,
  branchId: optionalUuid,
  departmentId: optionalUuid,
  supplierId: optionalUuid,
}).strict();

const creationScopeSchema = z.object({
  capturedAt: z.coerce.date(),
  roleId: uuidSchema,
  role: z.string().refine(isUserRole),
  accountKind: z.string().refine(isAccountKind),
  isOwner: z.boolean(),
  organizationName: z.string().trim().min(1).max(300),
  branchName: optionalText,
  departmentName: optionalText,
  supplierName: optionalText,
  scope: scopeSchema,
}).strict();

const targetSchema = z.object({
  capturedAt: z.coerce.date(),
  permission: z.literal("user.invite"),
  userId: uuidSchema,
  active: z.boolean(),
  isOwner: z.boolean(),
  accountKind: z.string().refine(isAccountKind),
  accountStatus: z.enum(["INVITED", "ACTIVE", "SUSPENDED", "DEACTIVATED"]),
  setupCompleted: z.boolean(),
  roleAssignmentId: uuidSchema,
  role: z.string().refine(isUserRole),
  scope: scopeSchema,
}).strict();

const resendTargetSchema = z.object({
  userId: uuidSchema,
  recipientName: z.string().trim().min(1).max(300),
  recipientEmail: z.email(),
  role: z.string().refine(isUserRole),
  roleId: uuidSchema,
  accountKind: z.string().refine(isAccountKind),
  scopeType: z.string().refine(isRoleScopeType),
  companyId: optionalUuid,
  companyName: z.string().trim().min(1).max(300),
  branchId: optionalUuid,
  branchName: optionalText,
  departmentId: optionalUuid,
  departmentName: optionalText,
  supplierId: optionalUuid,
  active: z.boolean(),
  setupCompleted: z.boolean(),
  organizationActive: z.boolean(),
  membershipReady: z.boolean(),
  preferredLocale: z.enum(["en", "ar", "ms"]),
  currentInvitationPresent: z.boolean(),
  latestInvitationId: uuidSchema.optional(),
  latestDeliveryStatus: z.enum(accountSetupDeliveryStatuses).optional(),
  latestInvitationCreatedAt: optionalDate,
  latestInvitationExpiresAt: optionalDate,
  latestInvitationSentAt: optionalDate,
  latestProviderMessagePresent: z.boolean(),
}).strict().superRefine((target, context) => {
  const currentFields = [
    target.latestInvitationId,
    target.latestDeliveryStatus,
    target.latestInvitationCreatedAt,
    target.latestInvitationExpiresAt,
  ];
  if (target.currentInvitationPresent
    && currentFields.some((value) => value === undefined)) {
    context.addIssue({
      code: "custom",
      message: "The current invitation snapshot is incomplete.",
    });
  }
  if (!target.currentInvitationPresent
    && currentFields.some((value) => value !== undefined)) {
    context.addIssue({
      code: "custom",
      message: "The invitation snapshot is inconsistent.",
    });
  }
});

interface SnapshotRow extends QueryResultRow {
  snapshot: unknown;
}

export class AccountInvitationAccessUnavailableError extends Error {
  constructor() {
    super("The requested account invitation scope is unavailable.");
    this.name = "AccountInvitationAccessUnavailableError";
  }
}

function requireAssignment(actor: SessionUser) {
  const parsed = uuidSchema.safeParse(actor.roleAssignmentId);
  if (!parsed.success) throw new AccountInvitationAccessUnavailableError();
  return parsed.data;
}

function claimedAssignment(actor: SessionUser) {
  if (actor.roleAssignmentId === undefined) return null;
  return requireAssignment(actor);
}

function requireAuthVersion(actor: SessionUser) {
  const parsed = z.coerce.number().int().positive().safeParse(actor.authVersion);
  if (!parsed.success) throw new AccountInvitationAccessUnavailableError();
  return parsed.data;
}

function creationMatches(
  resolved: ResolvedUserCreation,
  snapshot: z.infer<typeof creationScopeSchema>,
) {
  return snapshot.role === resolved.role
    && snapshot.accountKind === resolved.accountKind
    && snapshot.isOwner === (resolved.role === "PLATFORM_OWNER")
    && snapshot.scope.type === resolved.scopeType
    && snapshot.scope.companyId === resolved.companyId
    && snapshot.scope.branchId === resolved.branchId
    && snapshot.scope.supplierId === resolved.supplierId
    && snapshot.scope.departmentId === resolved.departmentId;
}

export async function lockAuthorizedInvitationCreationScope(
  client: PoolClient,
  actor: SessionUser,
  resolved: ResolvedUserCreation,
  capturedAt = new Date(),
) {
  if (!Number.isFinite(capturedAt.getTime())) {
    throw new AccountInvitationAccessUnavailableError();
  }

  try {
    const onboardingCompanyAdministrator = actor.accountKind === "PLATFORM"
      && resolved.role === "COMPANY_ADMIN"
      && resolved.scopeType === "COMPANY"
      && resolved.companyId;
    const result = onboardingCompanyAdministrator
      ? await client.query<SnapshotRow>(`
          SELECT public.axora_lock_company_admin_invitation_scope(
            $1,$2,$3,$4,$5
          ) AS snapshot
        `, [
          actor.id,
          claimedAssignment(actor),
          requireAuthVersion(actor),
          resolved.companyId,
          capturedAt,
        ])
      : await client.query<SnapshotRow>(`
          SELECT public.axora_lock_user_creation_scope(
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
          ) AS snapshot
        `, [
          actor.id,
          claimedAssignment(actor),
          requireAuthVersion(actor),
          resolved.role,
          resolved.scopeType,
          resolved.companyId ?? null,
          resolved.branchId ?? null,
          resolved.departmentId ?? null,
          resolved.supplierId ?? null,
          capturedAt,
        ]);
    const parsed = creationScopeSchema.safeParse(result.rows[0]?.snapshot);
    if (!parsed.success
      || parsed.data.capturedAt.getTime() !== capturedAt.getTime()
      || !creationMatches(resolved, parsed.data)) {
      throw new AccountInvitationAccessUnavailableError();
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof AccountInvitationAccessUnavailableError) throw error;
    throw new AccountInvitationAccessUnavailableError();
  }
}

export async function lockAuthorizedInvitationTarget(
  client: PoolClient,
  actor: SessionUser,
  targetUserId: string,
  capturedAt = new Date(),
) {
  if (!uuidSchema.safeParse(targetUserId).success
    || !Number.isFinite(capturedAt.getTime())) {
    throw new AccountInvitationAccessUnavailableError();
  }

  try {
    const result = await client.query<SnapshotRow>(`
      SELECT public.axora_lock_user_target_access(
        $1,$2,'user.invite',$3,$4
      ) AS snapshot
    `, [actor.id, requireAssignment(actor), targetUserId, capturedAt]);
    const parsed = targetSchema.safeParse(result.rows[0]?.snapshot);
    if (!parsed.success
      || parsed.data.capturedAt.getTime() !== capturedAt.getTime()
      || parsed.data.userId !== targetUserId) {
      throw new AccountInvitationAccessUnavailableError();
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof AccountInvitationAccessUnavailableError) throw error;
    throw new AccountInvitationAccessUnavailableError();
  }
}

export async function lockAuthorizedInvitationResendTarget(
  client: PoolClient,
  actor: SessionUser,
  targetUserId: string,
  capturedAt = new Date(),
) {
  if (!uuidSchema.safeParse(targetUserId).success
    || !Number.isFinite(capturedAt.getTime())) {
    throw new AccountInvitationAccessUnavailableError();
  }
  try {
    const result = await client.query<SnapshotRow>(`
      SELECT public.axora_account_setup_resend_target($1,$2,$3,$4,$5) AS snapshot
    `, [
      actor.id,
      claimedAssignment(actor),
      requireAuthVersion(actor),
      targetUserId,
      capturedAt,
    ]);
    const parsed = resendTargetSchema.safeParse(result.rows[0]?.snapshot);
    if (!parsed.success || parsed.data.userId !== targetUserId) {
      throw new AccountInvitationAccessUnavailableError();
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof AccountInvitationAccessUnavailableError) throw error;
    throw new AccountInvitationAccessUnavailableError();
  }
}

export const accountInvitationIsolationInternals = {
  creationMatches,
  creationScopeSchema,
  targetSchema,
  resendTargetSchema,
};

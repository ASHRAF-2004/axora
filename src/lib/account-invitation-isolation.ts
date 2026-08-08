import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { SessionUser } from "./auth";
import {
  isAccountKind,
  isRoleScopeType,
  isUserRole,
} from "./types";
import type { ResolvedUserCreation } from "./users";

const uuidSchema = z.string().uuid();
const optionalUuid = z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  uuidSchema.optional(),
);
const optionalText = z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  z.string().trim().min(1).max(300).optional(),
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
  accountStatus: z.enum(["INVITED", "ACTIVE", "SUSPENDED", "CLOSED"]),
  setupCompleted: z.boolean(),
  roleAssignmentId: uuidSchema,
  role: z.string().refine(isUserRole),
  scope: scopeSchema,
}).strict();

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
    && snapshot.scope.departmentId === undefined;
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
    const result = await client.query<SnapshotRow>(`
      SELECT public.axora_lock_user_creation_scope(
        $1,$2,$3,$4,$5,$6,$7,$8,$9
      ) AS snapshot
    `, [
      actor.id,
      requireAssignment(actor),
      resolved.role,
      resolved.scopeType,
      resolved.companyId ?? null,
      resolved.branchId ?? null,
      null,
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

export const accountInvitationIsolationInternals = {
  creationMatches,
  creationScopeSchema,
  targetSchema,
};

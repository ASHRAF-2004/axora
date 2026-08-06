import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import { isDemoMode, query } from "./db";
import {
  canonicalRoleForAuthorization,
  defaultPermissionsForRole,
  isPermissionCode,
  type ApprovalLimit,
  type AuthorizationScope,
  type AuthorizationSubject,
  type PermissionCode,
  type PermissionDelegation,
  type PermissionOverride,
} from "./authorization-policy";

const permissionCodeSchema = z.string()
  .refine(isPermissionCode, "Unknown authorization permission")
  .transform((value) => value as PermissionCode);

const scopeSchema = z.object({
  type: z.enum([
    "PLATFORM",
    "COMPANY",
    "BRANCH",
    "DEPARTMENT",
    "SUPPLIER",
    "DELIVERY",
  ]),
  companyId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  deliveryAssignmentId: z.string().uuid().optional(),
}).strict();

const permissionOverrideSchema = z.object({
  permission: permissionCodeSchema,
  effect: z.enum(["GRANT", "DENY"]),
  scope: scopeSchema,
  active: z.boolean(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
}).strict();

const delegationSchema = z.object({
  active: z.boolean(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  permissions: z.array(permissionCodeSchema),
  scopes: z.array(scopeSchema),
}).strict();

const approvalLimitSchema = z.object({
  permission: z.enum([
    "request.approve.other",
    "request.approve.self",
    "request.approve.over_budget",
    "request.approve.additional_actual",
  ]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  maximumAmount: z.coerce.number().finite().nonnegative(),
  allowSelfApproval: z.boolean(),
  active: z.boolean(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  scope: scopeSchema,
}).strict();

const liveSnapshotSchema = z.object({
  capturedAt: z.coerce.date(),
  accountStatus: z.literal("ACTIVE"),
  accountKind: z.enum(["PLATFORM", "COMPANY", "SUPPLIER", "DELIVERY"]),
  isOwner: z.boolean(),
  authVersion: z.coerce.number().int().nonnegative(),
  roleAssignmentId: z.string().uuid(),
  roleKey: z.string().trim().min(2).max(80),
  scopes: z.array(scopeSchema).min(1),
  rolePermissions: z.array(permissionCodeSchema),
  permissionOverrides: z.array(permissionOverrideSchema),
  delegations: z.array(delegationSchema),
  approvalLimits: z.array(approvalLimitSchema),
}).strict();

interface SnapshotRow extends QueryResultRow {
  snapshot: unknown;
}

export type EffectiveAccessSource =
  | "LIVE_DATABASE"
  | "SESSION_COMPATIBILITY";

export interface EffectiveAccessSnapshot {
  source: EffectiveAccessSource;
  capturedAt: Date;
  roleAssignmentId?: string;
  authVersion: number;
  subject: AuthorizationSubject;
}

export class EffectiveAccessUnavailableError extends Error {
  constructor() {
    super("The effective authorization context is unavailable.");
    this.name = "EffectiveAccessUnavailableError";
  }
}

function scopeFromSession(user: AuthenticatedSessionUser): AuthorizationScope | undefined {
  if (user.scopeType === "PLATFORM") {
    return { type: "PLATFORM" };
  }
  if (user.scopeType === "COMPANY" && user.companyId) {
    return { type: "COMPANY", companyId: user.companyId };
  }
  if (user.scopeType === "BRANCH" && user.companyId && user.branchId) {
    return {
      type: "BRANCH",
      companyId: user.companyId,
      branchId: user.branchId,
    };
  }
  if (user.scopeType === "DEPARTMENT" && user.companyId && user.departmentId) {
    return {
      type: "DEPARTMENT",
      companyId: user.companyId,
      ...(user.branchId ? { branchId: user.branchId } : {}),
      departmentId: user.departmentId,
    };
  }
  if (user.scopeType === "SUPPLIER" && user.supplierId) {
    return { type: "SUPPLIER", supplierId: user.supplierId };
  }
  if (user.scopeType === "DELIVERY") {
    return { type: "DELIVERY" };
  }
  return undefined;
}

function sameScope(first: AuthorizationScope, second: AuthorizationScope) {
  return first.type === second.type
    && first.companyId === second.companyId
    && first.branchId === second.branchId
    && first.departmentId === second.departmentId
    && first.supplierId === second.supplierId
    && first.deliveryAssignmentId === second.deliveryAssignmentId;
}

function compatibilitySnapshot(
  user: AuthenticatedSessionUser,
  capturedAt: Date,
): EffectiveAccessSnapshot {
  const scope = scopeFromSession(user);
  const role = canonicalRoleForAuthorization(
    user.role,
    user.scopeType,
    user.isOwner,
  );
  if (!scope || !role) throw new EffectiveAccessUnavailableError();

  return {
    source: "SESSION_COMPATIBILITY",
    capturedAt,
    ...(user.roleAssignmentId
      ? { roleAssignmentId: user.roleAssignmentId }
      : {}),
    authVersion: user.authVersion,
    subject: {
      userId: user.id,
      role,
      accountKind: user.accountKind,
      accountStatus: "ACTIVE",
      isOwner: user.isOwner,
      scopes: [scope],
      roleGrants: defaultPermissionsForRole(
        role,
        user.scopeType,
        user.isOwner,
      ),
      permissionOverrides: [],
      delegations: [],
      approvalLimits: [],
    },
  };
}

function validateSnapshotAgainstSession(
  user: AuthenticatedSessionUser,
  parsed: z.infer<typeof liveSnapshotSchema>,
) {
  const sessionScope = scopeFromSession(user);
  const sessionRole = canonicalRoleForAuthorization(
    user.role,
    user.scopeType,
    user.isOwner,
  );
  const snapshotRole = canonicalRoleForAuthorization(
    parsed.roleKey,
    user.scopeType,
    parsed.isOwner,
  );

  if (!sessionScope
    || !sessionRole
    || !snapshotRole
    || sessionRole !== snapshotRole
    || parsed.accountKind !== user.accountKind
    || parsed.isOwner !== user.isOwner
    || parsed.authVersion !== user.authVersion
    || parsed.roleAssignmentId !== user.roleAssignmentId
    || !parsed.scopes.some((scope) => sameScope(scope, sessionScope))) {
    throw new EffectiveAccessUnavailableError();
  }
}

export async function loadEffectiveAccess(
  user: AuthenticatedSessionUser,
  capturedAt = new Date(),
): Promise<EffectiveAccessSnapshot> {
  if (!Number.isFinite(capturedAt.getTime())) {
    throw new EffectiveAccessUnavailableError();
  }

  // Demo mode and retained pre-normalization sessions remain usable during the
  // expand phase. New high-risk role assignment types are not exposed for
  // creation until they can always carry a normalized assignment identifier.
  if (isDemoMode() || !user.roleAssignmentId) {
    return compatibilitySnapshot(user, capturedAt);
  }

  const result = await query<SnapshotRow>(
    `SELECT public.axora_effective_access_snapshot($1,$2,$3) AS snapshot`,
    [user.id, user.roleAssignmentId, capturedAt],
  );
  if (result.rowCount !== 1 || !result.rows[0]?.snapshot) {
    throw new EffectiveAccessUnavailableError();
  }

  const parsed = liveSnapshotSchema.safeParse(result.rows[0].snapshot);
  if (!parsed.success) throw new EffectiveAccessUnavailableError();
  validateSnapshotAgainstSession(user, parsed.data);

  return {
    source: "LIVE_DATABASE",
    capturedAt: parsed.data.capturedAt,
    roleAssignmentId: parsed.data.roleAssignmentId,
    authVersion: parsed.data.authVersion,
    subject: {
      userId: user.id,
      role: parsed.data.roleKey,
      accountKind: parsed.data.accountKind,
      accountStatus: parsed.data.accountStatus,
      isOwner: parsed.data.isOwner,
      scopes: parsed.data.scopes as AuthorizationScope[],
      roleGrants: parsed.data.rolePermissions as PermissionCode[],
      permissionOverrides: parsed.data.permissionOverrides as PermissionOverride[],
      delegations: parsed.data.delegations as PermissionDelegation[],
      approvalLimits: parsed.data.approvalLimits as ApprovalLimit[],
    },
  };
}

export const effectiveAccessInternals = {
  compatibilitySnapshot,
  liveSnapshotSchema,
  sameScope,
  scopeFromSession,
  validateSnapshotAgainstSession,
};
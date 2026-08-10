import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import {
  authorizationPolicyInternals,
  type AuthorizationScope,
} from "./authorization-policy";
import { query } from "./db";
import { accountRoleDefinition } from "./role-catalog";

const uuidSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(3).max(500)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), {
    message: "Reason cannot contain control characters",
  });

export const MANAGED_ROLE_KEYS = [
  "PLATFORM_OWNER",
  "PLATFORM_OPERATIONS",
  "TECHNICAL_SUPPORT",
  "CLIENT_ACCOUNT_MANAGER",
  "COMPANY_ADMIN",
  "BRANCH_ADMIN",
  "DEPARTMENT_ADMIN",
  "COMPANY_APPROVER",
  "BRANCH_APPROVER",
  "REQUESTER",
  "FINANCE_REVIEWER",
  "AUDITOR",
  "RECEIVING_USER",
  "DELIVERY_TEAM_SUPERVISOR",
  "DELIVERY_AGENT",
  "DELIVERY_DRIVER",
] as const;

export type ManagedRoleKey = (typeof MANAGED_ROLE_KEYS)[number];

const roleSchema = z.enum(MANAGED_ROLE_KEYS);
const scopeSchema = z.object({
  type: z.enum([
    "PLATFORM",
    "COMPANY",
    "BRANCH",
    "DEPARTMENT",
    "SUPPLIER",
    "DELIVERY",
  ]),
  companyId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  supplierId: uuidSchema.optional(),
}).strict().refine(
  (scope) => authorizationPolicyInternals.scopeIsStructurallyValid(scope),
  "Invalid authorization scope",
);

const assignRoleScopeSchema = z.object({
  commandId: uuidSchema,
  targetUserId: uuidSchema,
  role: roleSchema,
  scope: scopeSchema,
  reason: reasonSchema,
}).strict().superRefine((value, context) => {
  const definition = accountRoleDefinition(value.role);
  if (!definition || !definition.allowedScopes.includes(value.scope.type)) {
    context.addIssue({
      code: "custom",
      path: ["scope"],
      message: "The selected role does not support this scope",
    });
  }
});

const revokeRoleScopeSchema = z.object({
  commandId: uuidSchema,
  roleAssignmentId: uuidSchema,
  reason: reasonSchema,
}).strict();

interface RoleScopeChangeRow {
  roleAssignmentId: string;
  authVersion: number;
  revokedSessions: number;
  changed: boolean;
}

export interface RoleScopeChangeResult {
  roleAssignmentId: string;
  authVersion: number;
  revokedSessions: number;
  changed: boolean;
}

export class RoleScopeManagementUnavailableError extends Error {
  constructor() {
    super("The requested role or scope change could not be completed.");
    this.name = "RoleScopeManagementUnavailableError";
  }
}

function requireNormalizedActor(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) {
    throw new RoleScopeManagementUnavailableError();
  }
  return actor.roleAssignmentId;
}

function scopeArguments(scope: AuthorizationScope) {
  return [
    scope.type,
    scope.companyId ?? null,
    scope.branchId ?? null,
    scope.departmentId ?? null,
    scope.supplierId ?? null,
  ] as const;
}

function normalizeResult(
  row: RoleScopeChangeRow | undefined,
): RoleScopeChangeResult {
  if (!row || !uuidSchema.safeParse(row.roleAssignmentId).success
    || !Number.isInteger(Number(row.authVersion)) || Number(row.authVersion) < 1
    || !Number.isInteger(Number(row.revokedSessions))
    || Number(row.revokedSessions) < 0
    || typeof row.changed !== "boolean") {
    throw new RoleScopeManagementUnavailableError();
  }
  return {
    roleAssignmentId: row.roleAssignmentId,
    authVersion: Number(row.authVersion),
    revokedSessions: Number(row.revokedSessions),
    changed: row.changed,
  };
}

export async function assignUserRoleScope(
  actor: AuthenticatedSessionUser,
  input: z.input<typeof assignRoleScopeSchema>,
): Promise<RoleScopeChangeResult> {
  const actorRoleAssignmentId = requireNormalizedActor(actor);
  const parsed = assignRoleScopeSchema.parse(input);
  if (parsed.targetUserId === actor.id) {
    throw new RoleScopeManagementUnavailableError();
  }
  const [scopeType, companyId, branchId, departmentId, supplierId]
    = scopeArguments(parsed.scope);

  try {
    const result = await query<RoleScopeChangeRow>(
      `SELECT
         role_assignment_id::text AS "roleAssignmentId",
         auth_version::int AS "authVersion",
         revoked_sessions::int AS "revokedSessions",
         changed
       FROM public.axora_assign_user_role_scope(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
       )`,
      [
        parsed.commandId,
        actor.id,
        actorRoleAssignmentId,
        parsed.targetUserId,
        parsed.role,
        scopeType,
        companyId,
        branchId,
        departmentId,
        supplierId,
        parsed.reason,
      ],
    );
    return normalizeResult(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError
      || error instanceof RoleScopeManagementUnavailableError) {
      throw error;
    }
    throw new RoleScopeManagementUnavailableError();
  }
}

export async function revokeUserRoleScope(
  actor: AuthenticatedSessionUser,
  input: z.input<typeof revokeRoleScopeSchema>,
): Promise<RoleScopeChangeResult> {
  const actorRoleAssignmentId = requireNormalizedActor(actor);
  const parsed = revokeRoleScopeSchema.parse(input);

  try {
    const result = await query<RoleScopeChangeRow>(
      `SELECT
         role_assignment_id::text AS "roleAssignmentId",
         auth_version::int AS "authVersion",
         revoked_sessions::int AS "revokedSessions",
         changed
       FROM public.axora_revoke_user_role_scope($1,$2,$3,$4,$5)`,
      [
        parsed.commandId,
        actor.id,
        actorRoleAssignmentId,
        parsed.roleAssignmentId,
        parsed.reason,
      ],
    );
    return normalizeResult(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError
      || error instanceof RoleScopeManagementUnavailableError) {
      throw error;
    }
    throw new RoleScopeManagementUnavailableError();
  }
}

export const roleScopeManagementInternals = {
  assignRoleScopeSchema,
  normalizeResult,
  revokeRoleScopeSchema,
  scopeArguments,
};

import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import {
  authorizationPolicyInternals,
  isPermissionCode,
  type AuthorizationScope,
  type PermissionCode,
} from "./authorization-policy";
import { query } from "./db";

const uuidSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(3).max(500);
const permissionSchema = z.string()
  .refine(isPermissionCode, "Unknown permission")
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
  companyId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  supplierId: uuidSchema.optional(),
}).strict().refine(
  (scope) => authorizationPolicyInternals.scopeIsStructurallyValid(scope),
  "Invalid authorization scope",
);

const setPermissionOverrideSchema = z.object({
  targetUserId: uuidSchema,
  targetRoleAssignmentId: uuidSchema,
  permission: permissionSchema,
  effect: z.enum(["GRANT", "DENY"]),
  scope: scopeSchema,
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  reason: reasonSchema,
}).strict().superRefine((value, context) => {
  if (value.endsAt && value.startsAt
    && value.endsAt.getTime() <= value.startsAt.getTime()) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "Permission end time must be after its start time",
    });
  }
});

const removePermissionOverrideSchema = z.object({
  overrideId: uuidSchema,
  reason: reasonSchema,
}).strict();

interface PermissionChangeRow {
  overrideId: string;
  authVersion: number;
  revokedSessions: number;
  changed: boolean;
}

export interface PermissionChangeResult {
  overrideId: string;
  authVersion: number;
  revokedSessions: number;
  changed: boolean;
}

export class AccessManagementUnavailableError extends Error {
  constructor() {
    super("The requested access change could not be completed.");
    this.name = "AccessManagementUnavailableError";
  }
}

function requireNormalizedManagementActor(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) throw new AccessManagementUnavailableError();
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

function normalizeResult(row: PermissionChangeRow | undefined): PermissionChangeResult {
  if (!row || !uuidSchema.safeParse(row.overrideId).success
    || !Number.isInteger(Number(row.authVersion)) || Number(row.authVersion) < 1
    || !Number.isInteger(Number(row.revokedSessions)) || Number(row.revokedSessions) < 0
    || typeof row.changed !== "boolean") {
    throw new AccessManagementUnavailableError();
  }
  return {
    overrideId: row.overrideId,
    authVersion: Number(row.authVersion),
    revokedSessions: Number(row.revokedSessions),
    changed: row.changed,
  };
}

export async function setUserPermissionOverride(
  actor: AuthenticatedSessionUser,
  input: z.input<typeof setPermissionOverrideSchema>,
): Promise<PermissionChangeResult> {
  const actorRoleAssignmentId = requireNormalizedManagementActor(actor);
  const parsed = setPermissionOverrideSchema.parse(input);
  if (parsed.targetUserId === actor.id) throw new AccessManagementUnavailableError();
  const [scopeType, companyId, branchId, departmentId, supplierId]
    = scopeArguments(parsed.scope);

  try {
    const result = await query<PermissionChangeRow>(
      `SELECT
         override_id::text AS "overrideId",
         auth_version::int AS "authVersion",
         revoked_sessions::int AS "revokedSessions",
         changed
       FROM public.axora_set_user_permission_override(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
       )`,
      [
        actor.id,
        actorRoleAssignmentId,
        parsed.targetUserId,
        parsed.targetRoleAssignmentId,
        parsed.permission,
        parsed.effect,
        scopeType,
        companyId,
        branchId,
        departmentId,
        supplierId,
        parsed.startsAt ?? new Date(),
        parsed.endsAt ?? null,
        parsed.reason,
      ],
    );
    return normalizeResult(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof AccessManagementUnavailableError) {
      throw error;
    }
    throw new AccessManagementUnavailableError();
  }
}

export async function removeUserPermissionOverride(
  actor: AuthenticatedSessionUser,
  input: z.input<typeof removePermissionOverrideSchema>,
): Promise<PermissionChangeResult> {
  const actorRoleAssignmentId = requireNormalizedManagementActor(actor);
  const parsed = removePermissionOverrideSchema.parse(input);
  try {
    const result = await query<PermissionChangeRow>(
      `SELECT
         override_id::text AS "overrideId",
         auth_version::int AS "authVersion",
         revoked_sessions::int AS "revokedSessions",
         changed
       FROM public.axora_remove_user_permission_override($1,$2,$3,$4)`,
      [actor.id, actorRoleAssignmentId, parsed.overrideId, parsed.reason],
    );
    return normalizeResult(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof AccessManagementUnavailableError) {
      throw error;
    }
    throw new AccessManagementUnavailableError();
  }
}

export const accessManagementInternals = {
  normalizeResult,
  removePermissionOverrideSchema,
  scopeArguments,
  setPermissionOverrideSchema,
};

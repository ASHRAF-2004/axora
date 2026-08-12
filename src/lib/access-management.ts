import { z } from "zod";
import type { AuthenticatedSessionUser, SessionUser } from "./auth";
import {
  authorizationPolicyInternals,
  isPermissionCode,
  type AuthorizationScope,
  type PermissionCode,
} from "./authorization-policy";
import { query } from "./db";
import type { PoolClient } from "pg";

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
  // The caller persists this command timestamp before submission so an
  // ambiguous network retry reuses the same effective identity.
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  reason: reasonSchema,
}).strict().superRefine((value, context) => {
  if (!Number.isFinite(value.startsAt.getTime())) {
    context.addIssue({
      code: "custom",
      path: ["startsAt"],
      message: "Permission start time is invalid",
    });
  }
  if (value.endsAt && value.endsAt.getTime() <= value.startsAt.getTime()) {
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

const replacePermissionSetSchema = z.object({
  targetUserId: uuidSchema,
  targetRoleAssignmentId: uuidSchema,
  permissions: z.array(permissionSchema).max(120),
  reason: reasonSchema,
}).strict();

const permissionSetResultSchema = z.object({
  changed: z.boolean(),
  overrideCount: z.coerce.number().int().nonnegative(),
  revokedSessions: z.coerce.number().int().nonnegative(),
  authVersion: z.coerce.number().int().positive(),
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
        parsed.startsAt,
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

export async function replaceUserPermissionSetInTransaction(
  client: PoolClient,
  actor: SessionUser,
  input: z.input<typeof replacePermissionSetSchema>,
) {
  if (!actor.roleAssignmentId) throw new AccessManagementUnavailableError();
  const parsed = replacePermissionSetSchema.parse(input);
  const result = await client.query<{ payload: unknown }>(
    `SELECT public.axora_replace_user_permission_set(
       $1,$2,$3,$4,$5::text[],$6,now()
     ) AS payload`,
    [
      actor.id,
      actor.roleAssignmentId,
      parsed.targetUserId,
      parsed.targetRoleAssignmentId,
      [...new Set(parsed.permissions)].sort(),
      parsed.reason,
    ],
  );
  return permissionSetResultSchema.parse(result.rows[0]?.payload);
}

export async function replaceUserPermissionSet(
  actor: AuthenticatedSessionUser,
  input: z.input<typeof replacePermissionSetSchema>,
) {
  if (!actor.roleAssignmentId || input.targetUserId === actor.id) {
    throw new AccessManagementUnavailableError();
  }
  try {
    const parsed = replacePermissionSetSchema.parse(input);
    const result = await query<{ payload: unknown }>(
      `SELECT public.axora_replace_user_permission_set(
         $1,$2,$3,$4,$5::text[],$6,now()
       ) AS payload`,
      [
        actor.id,
        actor.roleAssignmentId,
        parsed.targetUserId,
        parsed.targetRoleAssignmentId,
        [...new Set(parsed.permissions)].sort(),
        parsed.reason,
      ],
    );
    return permissionSetResultSchema.parse(result.rows[0]?.payload);
  } catch (error) {
    if (error instanceof AccessManagementUnavailableError) throw error;
    throw new AccessManagementUnavailableError();
  }
}

export const accessManagementInternals = {
  normalizeResult,
  removePermissionOverrideSchema,
  scopeArguments,
  setPermissionOverrideSchema,
  replacePermissionSetSchema,
};

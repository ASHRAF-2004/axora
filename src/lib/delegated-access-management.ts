import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import {
  isPermissionCode,
  type PermissionCode,
} from "./authorization-policy";
import { query } from "./db";

const uuidSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(3).max(500);
const permissionSchema = z.string()
  .refine(isPermissionCode, "Unknown permission")
  .transform((value) => value as PermissionCode);

const delegationScopeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("COMPANY"),
    companyId: uuidSchema,
  }).strict(),
  z.object({
    type: z.literal("BRANCH"),
    companyId: uuidSchema,
    branchId: uuidSchema,
  }).strict(),
  z.object({
    type: z.literal("DEPARTMENT"),
    companyId: uuidSchema,
    branchId: uuidSchema.optional(),
    departmentId: uuidSchema,
  }).strict(),
]);

const createDelegatedAccessSchema = z.object({
  commandId: uuidSchema,
  granteeUserId: uuidSchema,
  granteeRoleAssignmentId: uuidSchema,
  permissions: z.array(permissionSchema).min(1).max(20)
    .transform((permissions, context) => {
      const normalized = [...new Set(permissions)].sort();
      if (normalized.length !== permissions.length) {
        context.addIssue({
          code: "custom",
          message: "Delegated permissions must be unique",
        });
        return z.NEVER;
      }
      return normalized;
    }),
  scopes: z.array(delegationScopeSchema).min(1).max(10),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  reason: reasonSchema,
}).strict().superRefine((value, context) => {
  if (!Number.isFinite(value.startsAt.getTime())) {
    context.addIssue({
      code: "custom",
      path: ["startsAt"],
      message: "Delegation start time is invalid",
    });
  }
  if (!Number.isFinite(value.endsAt.getTime())
    || value.endsAt.getTime() <= value.startsAt.getTime()) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "Delegation end time must be after its start time",
    });
  }
  if (value.endsAt.getTime() - value.startsAt.getTime()
    > 30 * 24 * 60 * 60 * 1000) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "Delegated access cannot exceed 30 days",
    });
  }
  if (value.permissions.length * value.scopes.length > 100) {
    context.addIssue({
      code: "custom",
      path: ["scopes"],
      message: "The delegated permission and scope combination is too large",
    });
  }
  const scopeKeys = value.scopes.map((scope) => JSON.stringify(scope));
  if (new Set(scopeKeys).size !== scopeKeys.length) {
    context.addIssue({
      code: "custom",
      path: ["scopes"],
      message: "Delegated scopes must be unique",
    });
  }
});

const revokeDelegatedAccessSchema = z.object({
  delegatedAccessId: uuidSchema,
  reason: reasonSchema,
}).strict();

interface DelegatedAccessChangeRow {
  delegatedAccessId: string;
  authVersion: number;
  revokedSessions: number;
  changed: boolean;
}

export interface DelegatedAccessChangeResult {
  delegatedAccessId: string;
  authVersion: number;
  revokedSessions: number;
  changed: boolean;
}

export class DelegatedAccessManagementUnavailableError extends Error {
  constructor() {
    super("The requested delegated-access change could not be completed.");
    this.name = "DelegatedAccessManagementUnavailableError";
  }
}

function requireNormalizedManagementActor(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) {
    throw new DelegatedAccessManagementUnavailableError();
  }
  return actor.roleAssignmentId;
}

function normalizeScopes(
  scopes: z.output<typeof delegationScopeSchema>[],
) {
  return [...scopes].sort((first, second) => (
    JSON.stringify(first).localeCompare(JSON.stringify(second))
  ));
}

function normalizeResult(
  row: DelegatedAccessChangeRow | undefined,
): DelegatedAccessChangeResult {
  if (!row || !uuidSchema.safeParse(row.delegatedAccessId).success
    || !Number.isInteger(Number(row.authVersion)) || Number(row.authVersion) < 1
    || !Number.isInteger(Number(row.revokedSessions)) || Number(row.revokedSessions) < 0
    || typeof row.changed !== "boolean") {
    throw new DelegatedAccessManagementUnavailableError();
  }
  return {
    delegatedAccessId: row.delegatedAccessId,
    authVersion: Number(row.authVersion),
    revokedSessions: Number(row.revokedSessions),
    changed: row.changed,
  };
}

export async function createDelegatedAccess(
  actor: AuthenticatedSessionUser,
  input: z.input<typeof createDelegatedAccessSchema>,
): Promise<DelegatedAccessChangeResult> {
  const actorRoleAssignmentId = requireNormalizedManagementActor(actor);
  const parsed = createDelegatedAccessSchema.parse(input);
  if (parsed.granteeUserId === actor.id) {
    throw new DelegatedAccessManagementUnavailableError();
  }
  const scopes = normalizeScopes(parsed.scopes);

  try {
    const result = await query<DelegatedAccessChangeRow>(
      `SELECT
         delegated_access_id::text AS "delegatedAccessId",
         auth_version::int AS "authVersion",
         revoked_sessions::int AS "revokedSessions",
         changed
       FROM public.axora_create_delegated_access(
         $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10
       )`,
      [
        parsed.commandId,
        actor.id,
        actorRoleAssignmentId,
        parsed.granteeUserId,
        parsed.granteeRoleAssignmentId,
        parsed.permissions,
        JSON.stringify(scopes),
        parsed.startsAt,
        parsed.endsAt,
        parsed.reason,
      ],
    );
    return normalizeResult(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError
      || error instanceof DelegatedAccessManagementUnavailableError) {
      throw error;
    }
    throw new DelegatedAccessManagementUnavailableError();
  }
}

export async function revokeDelegatedAccess(
  actor: AuthenticatedSessionUser,
  input: z.input<typeof revokeDelegatedAccessSchema>,
): Promise<DelegatedAccessChangeResult> {
  const actorRoleAssignmentId = requireNormalizedManagementActor(actor);
  const parsed = revokeDelegatedAccessSchema.parse(input);
  try {
    const result = await query<DelegatedAccessChangeRow>(
      `SELECT
         delegated_access_id::text AS "delegatedAccessId",
         auth_version::int AS "authVersion",
         revoked_sessions::int AS "revokedSessions",
         changed
       FROM public.axora_revoke_delegated_access($1,$2,$3,$4)`,
      [actor.id, actorRoleAssignmentId, parsed.delegatedAccessId, parsed.reason],
    );
    return normalizeResult(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError
      || error instanceof DelegatedAccessManagementUnavailableError) {
      throw error;
    }
    throw new DelegatedAccessManagementUnavailableError();
  }
}

export const delegatedAccessManagementInternals = {
  createDelegatedAccessSchema,
  delegationScopeSchema,
  normalizeResult,
  normalizeScopes,
  revokeDelegatedAccessSchema,
};

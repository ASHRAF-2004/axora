import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import {
  authorizationPolicyInternals,
  isPermissionCode,
  type AuthorizationScope,
  type PermissionCode,
} from "./authorization-policy";
import { isDemoMode, query } from "./db";
import { ACCOUNT_KINDS, ROLE_SCOPE_TYPES } from "./types";

const uuidSchema = z.string().uuid();
const permissionSchema = z.string()
  .refine(isPermissionCode, "Unknown authorization permission")
  .transform((value) => value as PermissionCode);
const scopeTypeSchema = z.enum(ROLE_SCOPE_TYPES);

const scopeSchema = z.object({
  type: scopeTypeSchema,
  companyId: uuidSchema.optional(),
  companyName: z.string().trim().min(1).max(200).optional(),
  branchId: uuidSchema.optional(),
  branchName: z.string().trim().min(1).max(200).optional(),
  departmentId: uuidSchema.optional(),
  departmentName: z.string().trim().min(1).max(200).optional(),
  supplierId: uuidSchema.optional(),
  supplierName: z.string().trim().min(1).max(200).optional(),
  deliveryAssignmentId: uuidSchema.optional(),
}).strict().superRefine((scope, context) => {
  const authorizationScope: AuthorizationScope = {
    type: scope.type,
    ...(scope.companyId ? { companyId: scope.companyId } : {}),
    ...(scope.branchId ? { branchId: scope.branchId } : {}),
    ...(scope.departmentId ? { departmentId: scope.departmentId } : {}),
    ...(scope.supplierId ? { supplierId: scope.supplierId } : {}),
    ...(scope.deliveryAssignmentId
      ? { deliveryAssignmentId: scope.deliveryAssignmentId }
      : {}),
  };
  if (!authorizationPolicyInternals.scopeIsStructurallyValid(authorizationScope)) {
    context.addIssue({
      code: "custom",
      message: "Invalid authorization scope",
    });
  }
});

const identitySchema = z.object({
  id: uuidSchema,
  displayName: z.string().trim().min(1).max(200),
  email: z.email().max(254),
  accountKind: z.enum(ACCOUNT_KINDS),
  accountStatus: z.literal("ACTIVE"),
  active: z.literal(true),
  authVersion: z.coerce.number().int().positive(),
  setupCompleted: z.literal(true),
  preferredLocale: z.enum(["en", "ar", "ms"]).optional(),
  jobTitle: z.string().trim().min(1).max(160).optional(),
}).strict();

const assignmentSchema = z.object({
  id: uuidSchema,
  roleKey: z.string().trim().min(2).max(80),
  roleLabel: z.string().trim().min(1).max(200),
  scope: scopeSchema,
  assignedAt: z.coerce.date(),
  selected: z.boolean(),
  manageable: z.boolean(),
}).strict();

const permissionOptionSchema = z.object({
  code: permissionSchema,
  group: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  description: z.string().max(1000),
  highRisk: z.boolean(),
  actorCanGrant: z.boolean(),
  targetRoleIncludes: z.boolean(),
  effective: z.boolean(),
}).strict();

const permissionOverrideSchema = z.object({
  id: uuidSchema,
  permission: permissionSchema,
  permissionLabel: z.string().trim().min(1).max(160),
  effect: z.enum(["GRANT", "DENY"]),
  scope: scopeSchema,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  reason: z.string().trim().min(3).max(500),
  changedByName: z.string().trim().min(1).max(200),
  manageable: z.boolean(),
}).strict();

const approvalLimitSchema = z.object({
  id: uuidSchema,
  subjectType: z.enum(["USER", "ROLE"]),
  permission: z.enum([
    "request.approve.other",
    "request.approve.self",
    "request.approve.over_budget",
    "request.approve.additional_actual",
  ]),
  permissionLabel: z.string().trim().min(1).max(160),
  currency: z.string().regex(/^[A-Z]{3}$/),
  maximumAmount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
  allowSelfApproval: z.boolean(),
  scope: scopeSchema,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  reason: z.string().trim().min(3).max(500),
}).strict();

const delegationSchema = z.object({
  id: uuidSchema,
  status: z.literal("ACTIVE"),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  reason: z.string().trim().min(3).max(500),
  authorizedByName: z.string().trim().min(1).max(200),
  permissions: z.array(permissionSchema).min(1).max(20),
  scopes: z.array(scopeSchema).min(1).max(10),
}).strict();

const historyValueSchema = z.record(z.string(), z.unknown());
const historySchema = z.object({
  id: uuidSchema,
  changeType: z.string().trim().min(2).max(80),
  previousValue: historyValueSchema.nullable().optional(),
  newValue: historyValueSchema.nullable().optional(),
  reason: z.string().trim().min(3).max(500),
  occurredAt: z.coerce.date(),
  actorName: z.string().trim().min(1).max(200),
}).strict();

const accessAdministrationSnapshotSchema = z.object({
  capturedAt: z.coerce.date(),
  canManagePermissions: z.boolean(),
  canViewHistory: z.boolean(),
  selectedAssignmentId: uuidSchema,
  selectedScope: scopeSchema,
  identity: identitySchema,
  assignments: z.array(assignmentSchema).min(1),
  rolePermissions: z.array(permissionSchema),
  scopes: z.array(scopeSchema).min(1),
  permissionOptions: z.array(permissionOptionSchema),
  permissionOverrides: z.array(permissionOverrideSchema),
  approvalLimits: z.array(approvalLimitSchema),
  delegations: z.array(delegationSchema),
  history: z.array(historySchema).max(50),
}).strict().superRefine((snapshot, context) => {
  const selected = snapshot.assignments.filter((assignment) => assignment.selected);
  if (selected.length !== 1 || selected[0]?.id !== snapshot.selectedAssignmentId) {
    context.addIssue({
      code: "custom",
      path: ["assignments"],
      message: "The selected assignment is inconsistent",
    });
  }
  if (snapshot.canManagePermissions
    && !snapshot.assignments.some((assignment) => (
      assignment.id === snapshot.selectedAssignmentId && assignment.manageable
    ))) {
    context.addIssue({
      code: "custom",
      path: ["canManagePermissions"],
      message: "The selected assignment is not manageable",
    });
  }
});

interface AccessAdministrationRow {
  snapshot: unknown;
}

export type AccessAdministrationSnapshot = z.infer<
  typeof accessAdministrationSnapshotSchema
>;

export class AccessAdministrationUnavailableError extends Error {
  constructor() {
    super("The requested access administration view is unavailable.");
    this.name = "AccessAdministrationUnavailableError";
  }
}

function requireNormalizedActor(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) {
    throw new AccessAdministrationUnavailableError();
  }
  return actor.roleAssignmentId;
}

export async function loadAccessAdministration(
  actor: AuthenticatedSessionUser,
  targetUserId: string,
  targetRoleAssignmentId?: string,
  capturedAt = new Date(),
): Promise<AccessAdministrationSnapshot> {
  const actorRoleAssignmentId = requireNormalizedActor(actor);
  const safeTargetUserId = uuidSchema.parse(targetUserId);
  const safeTargetRoleAssignmentId = targetRoleAssignmentId
    ? uuidSchema.parse(targetRoleAssignmentId)
    : undefined;
  if (!Number.isFinite(capturedAt.getTime()) || isDemoMode()) {
    throw new AccessAdministrationUnavailableError();
  }

  try {
    const result = await query<AccessAdministrationRow>(
      `SELECT public.axora_access_administration_snapshot(
         $1,$2,$3,$4,$5
       ) AS snapshot`,
      [
        actor.id,
        actorRoleAssignmentId,
        safeTargetUserId,
        safeTargetRoleAssignmentId ?? null,
        capturedAt,
      ],
    );
    const parsed = accessAdministrationSnapshotSchema.safeParse(
      result.rows[0]?.snapshot,
    );
    if (!parsed.success
      || parsed.data.identity.id !== safeTargetUserId
      || (safeTargetRoleAssignmentId
        && parsed.data.selectedAssignmentId !== safeTargetRoleAssignmentId)) {
      throw new AccessAdministrationUnavailableError();
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof z.ZodError
      || error instanceof AccessAdministrationUnavailableError) {
      throw error;
    }
    throw new AccessAdministrationUnavailableError();
  }
}

export const accessAdministrationInternals = {
  accessAdministrationSnapshotSchema,
  assignmentSchema,
  permissionOptionSchema,
  permissionOverrideSchema,
  scopeSchema,
};
import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import { query } from "./db";

const uuidSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(3).max(500);
const approvalPermissionSchema = z.enum([
  "request.approve.other",
  "request.approve.self",
  "request.approve.over_budget",
  "request.approve.additional_actual",
]);
const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
const amountSchema = z.string().trim().regex(
  /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/,
  "Enter a non-negative amount with no more than two decimal places",
);

const approvalScopeSchema = z.discriminatedUnion("type", [
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

const approvalLimitSubjectSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("USER"),
    userId: uuidSchema,
    roleAssignmentId: uuidSchema,
  }).strict(),
  z.object({
    type: z.literal("ROLE"),
    roleId: uuidSchema,
  }).strict(),
]);

const setApprovalLimitSchema = z.object({
  subject: approvalLimitSubjectSchema,
  permission: approvalPermissionSchema,
  scope: approvalScopeSchema,
  currency: currencySchema,
  maximumAmount: amountSchema,
  allowSelfApproval: z.boolean(),
  // Persist this timestamp with the initiating command. Reusing it makes an
  // ambiguous network retry idempotent instead of creating a replacement row.
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  reason: reasonSchema,
}).strict().superRefine((value, context) => {
  if (!Number.isFinite(value.startsAt.getTime())) {
    context.addIssue({
      code: "custom",
      path: ["startsAt"],
      message: "Approval-limit start time is invalid",
    });
  }
  if (value.endsAt && value.endsAt.getTime() <= value.startsAt.getTime()) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "Approval-limit end time must be after its start time",
    });
  }
  if (value.permission === "request.approve.self") {
    if (value.subject.type !== "USER" || !value.allowSelfApproval) {
      context.addIssue({
        code: "custom",
        path: ["allowSelfApproval"],
        message: "Self approval requires an explicitly permitted user",
      });
    }
  } else if (value.allowSelfApproval) {
    context.addIssue({
      code: "custom",
      path: ["allowSelfApproval"],
      message: "Self approval is valid only for request.approve.self",
    });
  }
});

const removeApprovalLimitSchema = z.object({
  approvalLimitId: uuidSchema,
  reason: reasonSchema,
}).strict();

interface ApprovalLimitChangeRow {
  approvalLimitId: string;
  affectedUsers: number;
  revokedSessions: number;
  changed: boolean;
}

export interface ApprovalLimitChangeResult {
  approvalLimitId: string;
  affectedUsers: number;
  revokedSessions: number;
  changed: boolean;
}

export class ApprovalLimitManagementUnavailableError extends Error {
  constructor() {
    super("The requested approval-limit change could not be completed.");
    this.name = "ApprovalLimitManagementUnavailableError";
  }
}

function requireNormalizedManagementActor(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) {
    throw new ApprovalLimitManagementUnavailableError();
  }
  return actor.roleAssignmentId;
}

function subjectArguments(
  subject: z.output<typeof approvalLimitSubjectSchema>,
) {
  return subject.type === "USER"
    ? [subject.userId, subject.roleAssignmentId, null] as const
    : [null, null, subject.roleId] as const;
}

function scopeArguments(scope: z.output<typeof approvalScopeSchema>) {
  return [
    scope.type,
    scope.companyId,
    scope.type === "COMPANY" ? null : scope.branchId ?? null,
    scope.type === "DEPARTMENT" ? scope.departmentId : null,
  ] as const;
}

function normalizeResult(
  row: ApprovalLimitChangeRow | undefined,
): ApprovalLimitChangeResult {
  if (!row || !uuidSchema.safeParse(row.approvalLimitId).success
    || !Number.isInteger(Number(row.affectedUsers)) || Number(row.affectedUsers) < 0
    || !Number.isInteger(Number(row.revokedSessions)) || Number(row.revokedSessions) < 0
    || typeof row.changed !== "boolean") {
    throw new ApprovalLimitManagementUnavailableError();
  }
  return {
    approvalLimitId: row.approvalLimitId,
    affectedUsers: Number(row.affectedUsers),
    revokedSessions: Number(row.revokedSessions),
    changed: row.changed,
  };
}

export async function setApprovalLimit(
  actor: AuthenticatedSessionUser,
  input: z.input<typeof setApprovalLimitSchema>,
): Promise<ApprovalLimitChangeResult> {
  const actorRoleAssignmentId = requireNormalizedManagementActor(actor);
  const parsed = setApprovalLimitSchema.parse(input);
  if (parsed.subject.type === "USER" && parsed.subject.userId === actor.id) {
    throw new ApprovalLimitManagementUnavailableError();
  }
  const [targetUserId, targetRoleAssignmentId, targetRoleId]
    = subjectArguments(parsed.subject);
  const [scopeType, companyId, branchId, departmentId]
    = scopeArguments(parsed.scope);

  try {
    const result = await query<ApprovalLimitChangeRow>(
      `SELECT
         approval_limit_id::text AS "approvalLimitId",
         affected_users::int AS "affectedUsers",
         revoked_sessions::int AS "revokedSessions",
         changed
       FROM public.axora_set_approval_limit(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
       )`,
      [
        actor.id,
        actorRoleAssignmentId,
        targetUserId,
        targetRoleAssignmentId,
        targetRoleId,
        parsed.permission,
        scopeType,
        companyId,
        branchId,
        departmentId,
        parsed.currency,
        parsed.maximumAmount,
        parsed.allowSelfApproval,
        parsed.startsAt,
        parsed.endsAt ?? null,
        parsed.reason,
      ],
    );
    return normalizeResult(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError
      || error instanceof ApprovalLimitManagementUnavailableError) {
      throw error;
    }
    throw new ApprovalLimitManagementUnavailableError();
  }
}

export async function removeApprovalLimit(
  actor: AuthenticatedSessionUser,
  input: z.input<typeof removeApprovalLimitSchema>,
): Promise<ApprovalLimitChangeResult> {
  const actorRoleAssignmentId = requireNormalizedManagementActor(actor);
  const parsed = removeApprovalLimitSchema.parse(input);
  try {
    const result = await query<ApprovalLimitChangeRow>(
      `SELECT
         approval_limit_id::text AS "approvalLimitId",
         affected_users::int AS "affectedUsers",
         revoked_sessions::int AS "revokedSessions",
         changed
       FROM public.axora_remove_approval_limit($1,$2,$3,$4)`,
      [actor.id, actorRoleAssignmentId, parsed.approvalLimitId, parsed.reason],
    );
    return normalizeResult(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError
      || error instanceof ApprovalLimitManagementUnavailableError) {
      throw error;
    }
    throw new ApprovalLimitManagementUnavailableError();
  }
}

export const approvalLimitManagementInternals = {
  amountSchema,
  approvalLimitSubjectSchema,
  approvalScopeSchema,
  normalizeResult,
  removeApprovalLimitSchema,
  scopeArguments,
  setApprovalLimitSchema,
  subjectArguments,
};

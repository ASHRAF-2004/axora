"use server";

import {
  AccessManagementUnavailableError,
  removeUserPermissionOverride,
  setUserPermissionOverride,
  replaceUserPermissionSet,
} from "@/lib/access-management";
import {
  authorizationPolicyInternals,
  isPermissionCode,
  type AuthorizationScope,
  type PermissionCode,
} from "@/lib/authorization-policy";
import { requirePermission } from "@/lib/auth";
import { ROLE_SCOPE_TYPES } from "@/lib/types";
import { readFormText } from "@/lib/validation";
import { parseZonedDateTime } from "@/lib/zoned-date-time";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const uuidSchema = z.string().uuid();
const permissionSchema = z.string()
  .refine(isPermissionCode, "Unknown permission")
  .transform((value) => value as PermissionCode);
const reasonSchema = z.string().trim().min(3).max(500)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));

const changeSchema = z.object({
  targetUserId: uuidSchema,
  targetRoleAssignmentId: uuidSchema,
  permission: permissionSchema,
  effect: z.enum(["GRANT", "DENY"]),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  reason: reasonSchema,
  scopeType: z.enum(ROLE_SCOPE_TYPES),
  companyId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  supplierId: uuidSchema.optional(),
}).strict().superRefine((value, context) => {
  const scope: AuthorizationScope = {
    type: value.scopeType,
    ...(value.companyId ? { companyId: value.companyId } : {}),
    ...(value.branchId ? { branchId: value.branchId } : {}),
    ...(value.departmentId ? { departmentId: value.departmentId } : {}),
    ...(value.supplierId ? { supplierId: value.supplierId } : {}),
  };
  if (!authorizationPolicyInternals.scopeIsStructurallyValid(scope)) {
    context.addIssue({
      code: "custom",
      path: ["scopeType"],
      message: "Invalid authorization scope",
    });
  }
  if (!Number.isFinite(value.startsAt.getTime())) {
    context.addIssue({
      code: "custom",
      path: ["startsAt"],
      message: "Invalid start time",
    });
  }
  if (value.endsAt && value.endsAt.getTime() <= value.startsAt.getTime()) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "The expiry must be after the start time",
    });
  }
});

const removeSchema = z.object({
  targetUserId: uuidSchema,
  targetRoleAssignmentId: uuidSchema,
  overrideId: uuidSchema,
  reason: reasonSchema,
}).strict();

function accessPath(
  targetUserId: string,
  targetRoleAssignmentId: string,
  notice?: string,
) {
  const base = `/users/${targetUserId}/access?assignment=${targetRoleAssignmentId}`;
  return notice ? `${base}&notice=${notice}` : base;
}

function scopeFromChange(
  change: z.output<typeof changeSchema>,
): AuthorizationScope {
  return {
    type: change.scopeType,
    ...(change.companyId ? { companyId: change.companyId } : {}),
    ...(change.branchId ? { branchId: change.branchId } : {}),
    ...(change.departmentId ? { departmentId: change.departmentId } : {}),
    ...(change.supplierId ? { supplierId: change.supplierId } : {}),
  };
}

export async function setPermissionOverrideAction(
  targetUserId: string,
  targetRoleAssignmentId: string,
  scopeType: string,
  companyId: string | undefined,
  branchId: string | undefined,
  departmentId: string | undefined,
  supplierId: string | undefined,
  formData: FormData,
) {
  const actor = await requirePermission("manage_users");

  let parsed: z.output<typeof changeSchema>;
  try {
    const expiryInput = readFormText(formData, "endsAt");
    parsed = changeSchema.parse({
      targetUserId,
      targetRoleAssignmentId,
      scopeType,
      companyId,
      branchId,
      departmentId,
      supplierId,
      permission: readFormText(formData, "permission"),
      effect: readFormText(formData, "effect"),
      startsAt: readFormText(formData, "startsAt"),
      endsAt: expiryInput
        ? parseZonedDateTime(
            expiryInput,
            actor.timezone ?? "Asia/Kuala_Lumpur",
          )
        : undefined,
      reason: readFormText(formData, "reason"),
    });
  } catch {
    redirect(accessPath(targetUserId, targetRoleAssignmentId, "invalid-change"));
  }

  try {
    await setUserPermissionOverride(actor, {
      targetUserId: parsed.targetUserId,
      targetRoleAssignmentId: parsed.targetRoleAssignmentId,
      permission: parsed.permission,
      effect: parsed.effect,
      scope: scopeFromChange(parsed),
      startsAt: parsed.startsAt,
      endsAt: parsed.endsAt,
      reason: parsed.reason,
    });
  } catch (error) {
    const notice = error instanceof z.ZodError
      ? "invalid-change"
      : error instanceof AccessManagementUnavailableError
        ? "change-unavailable"
        : "change-unavailable";
    redirect(accessPath(
      parsed.targetUserId,
      parsed.targetRoleAssignmentId,
      notice,
    ));
  }

  revalidatePath(`/users/${parsed.targetUserId}/access`);
  revalidatePath("/users");
  redirect(accessPath(
    parsed.targetUserId,
    parsed.targetRoleAssignmentId,
    "override-applied",
  ));
}

export async function removePermissionOverrideAction(
  targetUserId: string,
  targetRoleAssignmentId: string,
  overrideId: string,
  formData: FormData,
) {
  const actor = await requirePermission("manage_users");

  let parsed: z.output<typeof removeSchema>;
  try {
    parsed = removeSchema.parse({
      targetUserId,
      targetRoleAssignmentId,
      overrideId,
      reason: readFormText(formData, "reason"),
    });
  } catch {
    redirect(accessPath(targetUserId, targetRoleAssignmentId, "invalid-change"));
  }

  try {
    await removeUserPermissionOverride(actor, {
      overrideId: parsed.overrideId,
      reason: parsed.reason,
    });
  } catch (error) {
    const notice = error instanceof z.ZodError
      ? "invalid-change"
      : "change-unavailable";
    redirect(accessPath(
      parsed.targetUserId,
      parsed.targetRoleAssignmentId,
      notice,
    ));
  }

  revalidatePath(`/users/${parsed.targetUserId}/access`);
  revalidatePath("/users");
  redirect(accessPath(
    parsed.targetUserId,
    parsed.targetRoleAssignmentId,
    "override-removed",
  ));
}

export async function replacePermissionSetAction(
  targetUserId: string,
  targetRoleAssignmentId: string,
  formData: FormData,
) {
  const actor = await requirePermission("manage_users");
  try {
    await replaceUserPermissionSet(actor, {
      targetUserId,
      targetRoleAssignmentId,
      permissions: formData.getAll("permissions")
        .filter((value): value is string => typeof value === "string"),
      reason: readFormText(formData, "reason"),
    });
  } catch {
    redirect(accessPath(targetUserId, targetRoleAssignmentId, "change-unavailable"));
  }
  revalidatePath(`/users/${targetUserId}/access`);
  revalidatePath("/users");
  redirect(accessPath(targetUserId, targetRoleAssignmentId, "override-applied"));
}

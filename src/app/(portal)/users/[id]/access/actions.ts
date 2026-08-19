"use server";

import {
  AccessManagementUnavailableError,
  removeUserPermissionOverride,
  setUserPermissionOverride,
  replaceUserPermissionSet,
} from "@/lib/access-management";
import { removeApprovalLimit, setApprovalLimit } from "@/lib/approval-limit-management";
import {
  authorizationPolicyInternals,
  isPermissionCode,
  type AuthorizationScope,
  type PermissionCode,
} from "@/lib/authorization-policy";
import { requirePermission } from "@/lib/auth";
import { updateManagedUserProfile } from "@/lib/existing-user-management";
import { replaceUserRoleScope } from "@/lib/role-scope-management";
import { isRoleScopeType, isUserRole, ROLE_SCOPE_TYPES } from "@/lib/types";
import { setAuthorizedUserActive } from "@/lib/user-isolation";
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
    context.addIssue({ code: "custom", path: ["scopeType"], message: "Invalid authorization scope" });
  }
  if (!Number.isFinite(value.startsAt.getTime())) {
    context.addIssue({ code: "custom", path: ["startsAt"], message: "Invalid start time" });
  }
  if (value.endsAt && value.endsAt.getTime() <= value.startsAt.getTime()) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "The expiry must be after the start time" });
  }
});

const removeSchema = z.object({
  targetUserId: uuidSchema,
  targetRoleAssignmentId: uuidSchema,
  overrideId: uuidSchema,
  reason: reasonSchema,
}).strict();

function accessPath(targetUserId: string, targetRoleAssignmentId?: string, notice?: string) {
  const assignment = targetRoleAssignmentId ? `?assignment=${targetRoleAssignmentId}` : "";
  const separator = assignment ? "&" : "?";
  return notice
    ? `/users/${targetUserId}/access${assignment}${separator}notice=${notice}`
    : `/users/${targetUserId}/access${assignment}`;
}

function refreshUserManagement(targetUserId: string) {
  revalidatePath(`/users/${targetUserId}/access`);
  revalidatePath("/users");
}

function scopeFromChange(change: z.output<typeof changeSchema>): AuthorizationScope {
  return {
    type: change.scopeType,
    ...(change.companyId ? { companyId: change.companyId } : {}),
    ...(change.branchId ? { branchId: change.branchId } : {}),
    ...(change.departmentId ? { departmentId: change.departmentId } : {}),
    ...(change.supplierId ? { supplierId: change.supplierId } : {}),
  };
}

export async function updateManagedUserProfileAction(
  targetUserId: string,
  targetRoleAssignmentId: string,
  formData: FormData,
) {
  const actor = await requirePermission("manage_users");
  try {
    await updateManagedUserProfile(actor, {
      targetUserId,
      displayName: readFormText(formData, "displayName"),
      jobTitle: readFormText(formData, "jobTitle"),
      preferredLocale: readFormText(formData, "preferredLocale"),
    });
  } catch {
    redirect(accessPath(targetUserId,targetRoleAssignmentId,"change-unavailable"));
  }
  refreshUserManagement(targetUserId);
  redirect(accessPath(targetUserId,targetRoleAssignmentId,"profile-updated"));
}

export async function replaceRoleScopeAction(
  targetUserId: string,
  currentRoleAssignmentId: string,
  commandId: string,
  formData: FormData,
) {
  const actor = await requirePermission("manage_users");
  const rawRole = readFormText(formData,"role");
  const rawScopeType = readFormText(formData,"scopeType");
  if (!isUserRole(rawRole) || !isRoleScopeType(rawScopeType)) {
    redirect(accessPath(targetUserId,currentRoleAssignmentId,"change-unavailable"));
  }

  const companyId = readFormText(formData,"companyId") || undefined;
  const branchId = readFormText(formData,"branchId") || undefined;
  const departmentId = readFormText(formData,"departmentId") || undefined;
  const supplierId = readFormText(formData,"supplierId") || undefined;
  const scope: AuthorizationScope = {
    type: rawScopeType,
    ...(companyId ? { companyId } : {}),
    ...(branchId ? { branchId } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(supplierId ? { supplierId } : {}),
  };

  let nextRoleAssignmentId = currentRoleAssignmentId;
  try {
    const result = await replaceUserRoleScope(actor, {
      commandId,targetUserId,currentRoleAssignmentId,role: rawRole,scope,
      reason: readFormText(formData,"reason"),
    });
    nextRoleAssignmentId = result.roleAssignmentId;
  } catch {
    redirect(accessPath(targetUserId,currentRoleAssignmentId,"change-unavailable"));
  }

  refreshUserManagement(targetUserId);
  redirect(accessPath(targetUserId,nextRoleAssignmentId,"role-scope-updated"));
}

export async function setManagedApprovalLimitAction(
  targetUserId: string,
  targetRoleAssignmentId: string,
  scopeType: "COMPANY" | "BRANCH" | "DEPARTMENT",
  companyId: string,
  branchId: string | undefined,
  departmentId: string | undefined,
  startsAt: string,
  formData: FormData,
) {
  const actor = await requirePermission("manage_users");
  try {
    const permission = readFormText(formData,"permission") as
      | "request.approve.other"
      | "request.approve.self"
      | "request.approve.over_budget"
      | "request.approve.additional_actual";
    const expiry = readFormText(formData,"endsAt");
    const scope = scopeType === "COMPANY"
      ? { type: "COMPANY" as const,companyId }
      : scopeType === "BRANCH"
        ? { type: "BRANCH" as const,companyId,branchId: branchId ?? "" }
        : { type: "DEPARTMENT" as const,companyId,
            ...(branchId ? { branchId } : {}),departmentId: departmentId ?? "" };
    await setApprovalLimit(actor, {
      subject: { type: "USER",userId: targetUserId,roleAssignmentId: targetRoleAssignmentId },
      permission,scope,currency: readFormText(formData,"currency"),
      maximumAmount: readFormText(formData,"maximumAmount"),
      allowSelfApproval: permission === "request.approve.self"
        && formData.get("allowSelfApproval") === "on",
      startsAt,
      endsAt: expiry ? parseZonedDateTime(expiry,actor.timezone ?? "Asia/Kuala_Lumpur") : undefined,
      reason: readFormText(formData,"reason"),
    });
  } catch {
    redirect(accessPath(targetUserId,targetRoleAssignmentId,"change-unavailable"));
  }
  refreshUserManagement(targetUserId);
  redirect(accessPath(targetUserId,targetRoleAssignmentId,"approval-limit-updated"));
}

export async function removeManagedApprovalLimitAction(
  targetUserId: string,
  targetRoleAssignmentId: string,
  approvalLimitId: string,
  formData: FormData,
) {
  const actor = await requirePermission("manage_users");
  try {
    await removeApprovalLimit(actor, {
      approvalLimitId,reason: readFormText(formData,"reason"),
    });
  } catch {
    redirect(accessPath(targetUserId,targetRoleAssignmentId,"change-unavailable"));
  }
  refreshUserManagement(targetUserId);
  redirect(accessPath(targetUserId,targetRoleAssignmentId,"approval-limit-removed"));
}

export async function setManagedUserActiveAction(
  targetUserId: string,
  targetRoleAssignmentId: string,
  active: boolean,
) {
  const actor = await requirePermission("manage_users");
  try {
    await setAuthorizedUserActive(targetUserId,active,actor);
  } catch {
    redirect(accessPath(targetUserId,targetRoleAssignmentId,"change-unavailable"));
  }
  refreshUserManagement(targetUserId);
  redirect(accessPath(
    targetUserId,targetRoleAssignmentId,
    active ? "account-reactivated" : "account-deactivated",
  ));
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
    const expiryInput = readFormText(formData,"endsAt");
    parsed = changeSchema.parse({
      targetUserId,targetRoleAssignmentId,scopeType,companyId,branchId,departmentId,supplierId,
      permission: readFormText(formData,"permission"),effect: readFormText(formData,"effect"),
      startsAt: readFormText(formData,"startsAt"),
      endsAt: expiryInput
        ? parseZonedDateTime(expiryInput,actor.timezone ?? "Asia/Kuala_Lumpur")
        : undefined,
      reason: readFormText(formData,"reason"),
    });
  } catch {
    redirect(accessPath(targetUserId,targetRoleAssignmentId,"invalid-change"));
  }
  try {
    await setUserPermissionOverride(actor, {
      targetUserId: parsed.targetUserId,targetRoleAssignmentId: parsed.targetRoleAssignmentId,
      permission: parsed.permission,effect: parsed.effect,scope: scopeFromChange(parsed),
      startsAt: parsed.startsAt,endsAt: parsed.endsAt,reason: parsed.reason,
    });
  } catch (error) {
    const notice = error instanceof z.ZodError ? "invalid-change"
      : error instanceof AccessManagementUnavailableError ? "change-unavailable" : "change-unavailable";
    redirect(accessPath(parsed.targetUserId,parsed.targetRoleAssignmentId,notice));
  }
  refreshUserManagement(parsed.targetUserId);
  redirect(accessPath(parsed.targetUserId,parsed.targetRoleAssignmentId,"override-applied"));
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
      targetUserId,targetRoleAssignmentId,overrideId,reason: readFormText(formData,"reason"),
    });
  } catch {
    redirect(accessPath(targetUserId,targetRoleAssignmentId,"invalid-change"));
  }
  try {
    await removeUserPermissionOverride(actor, {
      overrideId: parsed.overrideId,reason: parsed.reason,
    });
  } catch (error) {
    const notice = error instanceof z.ZodError ? "invalid-change" : "change-unavailable";
    redirect(accessPath(parsed.targetUserId,parsed.targetRoleAssignmentId,notice));
  }
  refreshUserManagement(parsed.targetUserId);
  redirect(accessPath(parsed.targetUserId,parsed.targetRoleAssignmentId,"override-removed"));
}

export async function replacePermissionSetAction(
  targetUserId: string,
  targetRoleAssignmentId: string,
  formData: FormData,
) {
  const actor = await requirePermission("manage_users");
  try {
    await replaceUserPermissionSet(actor, {
      targetUserId,targetRoleAssignmentId,
      permissions: formData.getAll("permissions")
        .filter((value): value is string => typeof value === "string"),
      reason: readFormText(formData,"reason"),
    });
  } catch {
    redirect(accessPath(targetUserId,targetRoleAssignmentId,"change-unavailable"));
  }
  refreshUserManagement(targetUserId);
  redirect(accessPath(targetUserId,targetRoleAssignmentId,"permissions-updated"));
}

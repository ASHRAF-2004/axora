"use server";

import { replaceUserPermissionSet } from "@/lib/access-management";
import { requirePermission } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function accessPath(targetUserId: string, targetRoleAssignmentId: string, notice: string) {
  return `/users/${targetUserId}/access?assignment=${targetRoleAssignmentId}&notice=${notice}`;
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
      reason: "USER_PERMISSION_UPDATED",
    });
  } catch {
    redirect(accessPath(targetUserId, targetRoleAssignmentId, "change-unavailable"));
  }
  revalidatePath(`/users/${targetUserId}/access`);
  revalidatePath("/users");
  redirect(accessPath(targetUserId, targetRoleAssignmentId, "permissions-updated"));
}

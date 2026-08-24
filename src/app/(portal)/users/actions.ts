"use server";

import {
  AccountSetupInvitationQuotaError,
  AccountSetupResendEligibilityError,
  AccountSetupResendRateLimitError,
  createInvitedUser,
  resendAccountSetupInvitation,
  type AccountSetupInvitationResult,
} from "@/lib/account-setup";
import {
  deliverAccountSetupInvitation,
  type AccountInvitationDeliveryOutcome,
} from "@/lib/account-invitation-delivery";
import { AccessManagementUnavailableError } from "@/lib/access-management";
import { requirePermission, requireSession } from "@/lib/auth";
import { AccountInvitationAccessUnavailableError } from "@/lib/account-invitation-isolation";
import { removeAuthorizedUser, setAuthorizedUserActive } from "@/lib/user-isolation";
import { deactivateAuthorizedProfileImage } from "@/lib/profile-images";
import { isUserRole, type UserRole } from "@/lib/types";
import { readFormText } from "@/lib/validation";
import { SUPPORTED_LOCALES } from "@/lib/i18n";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  defaultPermissionsForRole,
  isPermissionCode,
  permissionIsCompatibleWithAccountKind,
  type PermissionCode,
} from "@/lib/authorization-policy";
import {
  UserProvisioningValidationError,
  validateProvisioningOrganizationShape,
} from "@/lib/user-provisioning";
import { accountRoleDefinition } from "@/lib/role-catalog";
import { isDemoMode } from "@/lib/db";
import { canAccess } from "@/lib/permissions";
import { UserCreationError } from "@/lib/users";

const scopedIdentifierSchema = z.string().trim().min(1).max(120).refine(
  (value) => z.uuid().safeParse(value).success
    || (isDemoMode() && /^(?:co|br|su)-[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value)),
  "Choose an authorized organization scope.",
);

const userSchema = z.object({ email: z.email(), displayName: z.string().trim().min(2).max(200),
  role: z.custom<UserRole>((value) => isUserRole(value), "Choose an approved account role."),
  companyId: scopedIdentifierSchema.optional(), branchId: scopedIdentifierSchema.optional(), departmentId: scopedIdentifierSchema.optional(), supplierId: scopedIdentifierSchema.optional(),
  jobTitle: z.string().trim().max(160).optional(),
  preferredLocale: z.enum(SUPPORTED_LOCALES),
  permissions: z.array(z.string().refine(isPermissionCode).transform((value) => value as PermissionCode)).max(120).optional(),
});

function invitationNotice(
  delivery: AccountInvitationDeliveryOutcome,
  operation: "created" | "resent",
) {
  if (operation === "created") {
    if (delivery === "sent") return "user-invited";
    if (delivery === "sent-lifecycle-sync-failed") {
      return "user-created-lifecycle-sync-failed";
    }
    if (delivery === "disabled") return "user-created-email-disabled";
    if (delivery === "unconfirmed") return "user-created-email-unconfirmed";
    return "user-created-email-failed";
  }
  if (delivery === "sent") return "user-invitation-resent";
  if (delivery === "disabled") return "user-resend-email-disabled";
  if (delivery === "unconfirmed") return "user-resend-email-unconfirmed";
  return "user-resend-email-failed";
}

function invitationQuotaNotice(error: AccountSetupInvitationQuotaError) {
  return `user-invitation-quota-${error.reason}`;
}

function userCreationNotice(error: UserCreationError) {
  if (error.reason === "invitation-pending") return "user-invitation-pending";
  if (error.reason === "account-active") return "user-account-active";
  if (error.reason === "account-deactivated") return "user-account-deactivated";
  if (error.reason === "account-exists") return "user-account-exists";
  if (error.reason === "resource-unavailable") return "user-creation-stale";
  return "user-creation-invalid";
}

export async function createUserAction(formData: FormData) {
  const actor = await requireSession();
  if (!canAccess(actor, "manage_users")) redirect("/access-denied");
  const submittedCompanyId = readFormText(formData, "companyId");
  if (actor.accountKind === "COMPANY"
    && (!actor.companyId || (submittedCompanyId && submittedCompanyId !== actor.companyId))) {
    redirect("/users?notice=user-creation-not-authorized");
  }
  const rawCompanyId = actor.accountKind === "COMPANY"
    ? actor.companyId ?? ""
    : submittedCompanyId;
  const contextValue = readFormText(formData, "creationContext");
  const requestedContext = z.enum(["PLATFORM", "COMPANY", "DELIVERY"]).safeParse(contextValue);
  const routeFor = (
    context: "PLATFORM" | "COMPANY" | "DELIVERY" | "LEGACY",
    companyId?: string,
  ) => (
    context === "COMPANY" && actor.accountKind === "COMPANY"
      ? "/users"
      : context === "COMPANY" && companyId
        ? `/companies/${encodeURIComponent(companyId)}/users`
      : context === "DELIVERY" ? "/deliveries"
      : "/users"
  );
  const permissionsCustomized = readFormText(
    formData,
    "permissionsCustomized",
  ) === "true";
  const creationContext: "PLATFORM" | "COMPANY" | "DELIVERY" | "LEGACY" =
    actor.accountKind === "COMPANY"
      ? "COMPANY"
      : requestedContext.success ? requestedContext.data : "LEGACY";
  const returnCompanyId = scopedIdentifierSchema.safeParse(rawCompanyId).success
    ? rawCompanyId
    : undefined;
  const parsedInput = userSchema.safeParse({ email: readFormText(formData, "email"), displayName: readFormText(formData, "displayName"),
      role: readFormText(formData, "role"),
      companyId: rawCompanyId || undefined,
      branchId: readFormText(formData, "branchId") || undefined,
      departmentId: readFormText(formData, "departmentId") || undefined,
      supplierId: readFormText(formData, "supplierId") || undefined,
      jobTitle: readFormText(formData, "jobTitle") || undefined,
      preferredLocale: readFormText(formData, "preferredLocale") || "en",
      permissions: permissionsCustomized
        ? formData.getAll("permissions").filter(
          (value): value is string => typeof value === "string",
        )
        : undefined,
    });
  if (!parsedInput.success) {
    redirect(`${routeFor(creationContext, returnCompanyId)}?notice=user-creation-invalid`);
  }
  const input: z.infer<typeof userSchema> = parsedInput.data;
  const definition = accountRoleDefinition(input.role);
  if (!definition
    || (creationContext === "PLATFORM" && (
      definition.accountKind !== "PLATFORM"
      || actor.accountKind !== "PLATFORM"
      || !actor.isOwner
    ))
    || (creationContext === "DELIVERY" && (
      definition.accountKind !== "DELIVERY"
      || actor.accountKind !== "PLATFORM"
      || !actor.isOwner
    ))
    || (creationContext === "COMPANY" && (
      definition.accountKind !== "COMPANY" || !input.companyId
      || input.role === "DEPARTMENT_ADMIN"
    ))) {
    redirect(`${routeFor(creationContext, returnCompanyId)}?notice=user-creation-invalid`);
  }
  try {
    validateProvisioningOrganizationShape(input);
  } catch (error) {
    if (!(error instanceof UserProvisioningValidationError)) throw error;
    redirect(`${routeFor(creationContext, returnCompanyId)}?notice=user-creation-invalid`);
  }
  if (input.permissions) {
    if (input.role === "PLATFORM_OWNER") {
      redirect(`${routeFor(creationContext, returnCompanyId)}?notice=user-creation-invalid`);
    }
    const selectedScope = input.departmentId
      ? "DEPARTMENT"
      : input.branchId ? "BRANCH" : definition.allowedScopes[0];
    const roleDefaults = new Set(defaultPermissionsForRole(
      input.role,
      selectedScope,
      input.role === "PLATFORM_OWNER",
    ));
    if (input.permissions.some((permission) => (
      !roleDefaults.has(permission)
      && !permissionIsCompatibleWithAccountKind(
        permission,
        definition.accountKind,
      )
    ))) {
      redirect(`${routeFor(creationContext, returnCompanyId)}?notice=user-creation-invalid`);
    }
  }
  const destination = routeFor(creationContext, input.companyId);
  let invitation: AccountSetupInvitationResult;
  try {
    invitation = await createInvitedUser(input, actor);
  } catch (error) {
    if (error instanceof AccountSetupInvitationQuotaError) {
      redirect(`${destination}?notice=${invitationQuotaNotice(error)}`);
    }
    if (error instanceof UserCreationError) {
      redirect(`${destination}?notice=${userCreationNotice(error)}`);
    }
    if (error instanceof AccountInvitationAccessUnavailableError) {
      redirect(`${destination}?notice=user-creation-not-authorized`);
    }
    if (error instanceof AccessManagementUnavailableError) {
      redirect(`${destination}?notice=user-permission-selection-unavailable`);
    }
    throw error;
  }
  const delivery = await deliverAccountSetupInvitation(invitation, actor);
  revalidatePath("/users");
  if (input.companyId) revalidatePath(`/companies/${input.companyId}/users`);
  redirect(`${destination}?notice=${invitationNotice(delivery, "created")}`);
}

export async function createAxoraUserAction(formData: FormData) {
  formData.set("creationContext", "PLATFORM");
  formData.delete("companyId");
  formData.delete("branchId");
  formData.delete("departmentId");
  formData.delete("supplierId");
  return createUserAction(formData);
}

export async function createCompanyUserAction(
  companyId: string,
  formData: FormData,
) {
  const parsedCompanyId = scopedIdentifierSchema.safeParse(companyId);
  if (!parsedCompanyId.success) redirect("/users?notice=user-creation-invalid");
  formData.set("creationContext", "COMPANY");
  formData.set("companyId", parsedCompanyId.data);
  formData.delete("supplierId");
  return createUserAction(formData);
}

export async function createOwnCompanyUserAction(formData: FormData) {
  const actor = await requireSession();
  if (actor.accountKind !== "COMPANY" || !actor.companyId
    || !canAccess(actor, "create_company_users")) {
    redirect("/access-denied");
  }
  formData.set("creationContext", "COMPANY");
  formData.set("companyId", actor.companyId);
  formData.delete("departmentId");
  formData.delete("supplierId");
  return createUserAction(formData);
}

export async function createDeliveryUserAction(formData: FormData) {
  formData.set("creationContext", "DELIVERY");
  formData.delete("companyId");
  formData.delete("branchId");
  formData.delete("departmentId");
  formData.delete("supplierId");
  return createUserAction(formData);
}

export type InvitationResendActionState = {
  status: "idle" | "success" | "error";
  code?: "sent" | "disabled" | "failed" | "unconfirmed" | "pending"
    | "delivered" | "cooldown" | "hourly" | "quota" | "ineligible"
    | "lifecycle_sync_failed";
};

export async function resendAccountSetupInvitationAction(
  _previous: InvitationResendActionState,
  formData: FormData,
): Promise<InvitationResendActionState> {
  const actor = await requirePermission("manage_users");
  const parsedUserId = z.uuid().safeParse(readFormText(formData, "userId"));
  if (!parsedUserId.success) return { status: "error", code: "ineligible" };
  let invitation: AccountSetupInvitationResult;
  try {
    invitation = await resendAccountSetupInvitation(parsedUserId.data, actor);
  } catch (error) {
    if (error instanceof AccountSetupInvitationQuotaError) {
      return { status: "error", code: "quota" };
    }
    if (error instanceof AccountSetupResendRateLimitError) {
      return { status: "error", code: error.reason };
    }
    if (error instanceof AccountSetupResendEligibilityError) {
      return { status: "error", code: error.reason };
    }
    return { status: "error", code: "ineligible" };
  }
  const delivery = await deliverAccountSetupInvitation(invitation, actor);
  revalidatePath("/users");
  return {
    status: delivery === "sent" ? "success" : "error",
    code: delivery === "sent-lifecycle-sync-failed"
      ? "lifecycle_sync_failed"
      : delivery,
  };
}

export async function setUserActiveAction(id: string, active: boolean) {
  const actor = await requirePermission("manage_users");
  await setAuthorizedUserActive(
    z.uuid().parse(id),
    z.boolean().parse(active),
    actor,
  );
  revalidatePath("/users");
}

export async function removeUserAction(id: string, formData: FormData) {
  const actor = await requirePermission("manage_users");
  const targetUserId = z.uuid().parse(id);
  const confirmed = readFormText(formData, "confirmRemoval") === "confirmed";
  if (!confirmed) redirect("/users?notice=remove-unavailable");
  try {
    await removeAuthorizedUser(targetUserId, "USER_REMOVED", actor);
  } catch {
    redirect("/users?notice=remove-unavailable");
  }
  revalidatePath("/users");
  redirect("/users?notice=user-removed");
}

export async function deactivateUserProfileImageAction(id: string) {
  const actor = await requirePermission("manage_users");
  await deactivateAuthorizedProfileImage(z.uuid().parse(id), actor);
  revalidatePath("/users");
}

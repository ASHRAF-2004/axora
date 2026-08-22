"use server";

import { sendAccountSetupEmail } from "@/lib/account-email";
import {
  AccountSetupInvitationQuotaError,
  AccountSetupResendEligibilityError,
  AccountSetupResendRateLimitError,
  createInvitedUser,
  recordAccountSetupDelivery,
  resendAccountSetupInvitation,
  type AccountSetupInvitationResult,
} from "@/lib/account-setup";
import { AccessManagementUnavailableError } from "@/lib/access-management";
import { requirePermission } from "@/lib/auth";
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
import { validateProvisioningOrganizationShape } from "@/lib/user-provisioning";
import { accountRoleDefinition } from "@/lib/role-catalog";
import { isDemoMode } from "@/lib/db";

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

type InvitationDelivery = "sent" | "disabled" | "failed" | "unconfirmed";

async function deliverInvitation(
  invitation: AccountSetupInvitationResult,
): Promise<InvitationDelivery> {
  let delivery: Awaited<ReturnType<typeof sendAccountSetupEmail>>;
  try {
    delivery = await sendAccountSetupEmail(invitation);
  } catch {
    delivery = { succeeded: false, status: "failed" };
  }

  try {
    await recordAccountSetupDelivery(invitation.invitationId, {
      succeeded: delivery.succeeded,
      providerMessageId: delivery.providerMessageId,
      status: delivery.status,
    });
  } catch {
    return "unconfirmed";
  }

  if (delivery.succeeded) return "sent";
  return delivery.status === "disabled" ? "disabled" : "failed";
}

function invitationNotice(
  delivery: InvitationDelivery,
  operation: "created" | "resent",
) {
  if (operation === "created") {
    if (delivery === "sent") return "user-invited";
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

export async function createUserAction(formData: FormData) {
  const actor = await requirePermission("manage_users");
  const rawCompanyId = readFormText(formData, "companyId");
  const contextValue = readFormText(formData, "creationContext");
  const requestedContext = z.enum(["PLATFORM", "COMPANY", "DELIVERY"]).safeParse(contextValue);
  const routeFor = (
    context: "PLATFORM" | "COMPANY" | "DELIVERY" | "LEGACY",
    companyId?: string,
  ) => (
    context === "COMPANY" && companyId
      ? `/companies/${encodeURIComponent(companyId)}/users`
      : context === "DELIVERY" ? "/deliveries"
      : "/users"
  );
  const permissionsCustomized = readFormText(
    formData,
    "permissionsCustomized",
  ) === "true";
  let input: z.infer<typeof userSchema>;
  const creationContext: "PLATFORM" | "COMPANY" | "DELIVERY" | "LEGACY" =
    requestedContext.success ? requestedContext.data : "LEGACY";
  const returnCompanyId = scopedIdentifierSchema.safeParse(rawCompanyId).success
    ? rawCompanyId
    : undefined;
  try {
    input = userSchema.parse({ email: readFormText(formData, "email"), displayName: readFormText(formData, "displayName"),
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
      ))) {
      throw new Error("The selected role is unavailable in this user workspace.");
    }
    validateProvisioningOrganizationShape(input);
    if (input.permissions) {
      if (input.role === "PLATFORM_OWNER") {
        throw new Error("Protected Platform Owner permissions use canonical defaults.");
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
        throw new Error("A selected permission is incompatible with the account type.");
      }
    }
  } catch {
    redirect(`${routeFor(creationContext, returnCompanyId)}?notice=user-creation-invalid`);
  }
  const destination = routeFor(creationContext, input.companyId);
  let invitation: AccountSetupInvitationResult;
  try {
    invitation = await createInvitedUser(input, actor);
  } catch (error) {
    if (error instanceof AccountSetupInvitationQuotaError) {
      redirect(`${destination}?notice=${invitationQuotaNotice(error)}`);
    }
    if (error instanceof AccessManagementUnavailableError) {
      redirect(`${destination}?notice=user-permission-selection-unavailable`);
    }
    throw error;
  }
  const delivery = await deliverInvitation(invitation);
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
  formData.set("creationContext", "COMPANY");
  formData.set("companyId", scopedIdentifierSchema.parse(companyId));
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
    | "delivered" | "cooldown" | "hourly" | "quota" | "ineligible";
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
  const delivery = await deliverInvitation(invitation);
  revalidatePath("/users");
  return {
    status: delivery === "sent" ? "success" : "error",
    code: delivery,
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

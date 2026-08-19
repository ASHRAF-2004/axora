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
import { isPermissionCode, type PermissionCode } from "@/lib/authorization-policy";
import { validateProvisioningOrganizationShape } from "@/lib/user-provisioning";

const userSchema = z.object({ email: z.email(), displayName: z.string().trim().min(2).max(200),
  role: z.custom<UserRole>((value) => isUserRole(value), "Choose an approved account role."),
  companyId: z.uuid().optional(), branchId: z.uuid().optional(), departmentId: z.uuid().optional(), supplierId: z.uuid().optional(),
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
  const permissionsCustomized = readFormText(
    formData,
    "permissionsCustomized",
  ) === "true";
  let input: z.infer<typeof userSchema>;
  try {
    input = userSchema.parse({ email: readFormText(formData, "email"), displayName: readFormText(formData, "displayName"),
      role: readFormText(formData, "role"),
      companyId: readFormText(formData, "companyId") || undefined,
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
    validateProvisioningOrganizationShape(input);
  } catch {
    redirect("/users?notice=user-creation-invalid");
  }
  let invitation: AccountSetupInvitationResult;
  try {
    invitation = await createInvitedUser(input, actor);
  } catch (error) {
    if (error instanceof AccountSetupInvitationQuotaError) {
      redirect(`/users?notice=${invitationQuotaNotice(error)}`);
    }
    if (error instanceof AccessManagementUnavailableError) {
      redirect("/users?notice=user-permission-selection-unavailable");
    }
    throw error;
  }
  const delivery = await deliverInvitation(invitation);
  revalidatePath("/users");
  redirect(`/users?notice=${invitationNotice(delivery, "created")}`);
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
  const reason = z.string().trim().min(3).max(500).parse(
    readFormText(formData, "reason"),
  );
  if (!confirmed) redirect("/users?notice=remove-unavailable");
  try {
    await removeAuthorizedUser(targetUserId, reason, actor);
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

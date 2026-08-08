"use server";

import { sendAccountSetupEmail } from "@/lib/account-email";
import {
  AccountSetupInvitationQuotaError,
  AccountSetupResendRateLimitError,
  createInvitedUser,
  recordAccountSetupDelivery,
  resendAccountSetupInvitation,
  type AccountSetupInvitationResult,
} from "@/lib/account-setup";
import { requirePermission, requireRecentStepUp } from "@/lib/auth";
import { setAuthorizedUserActive } from "@/lib/user-isolation";
import { isUserRole, type UserRole } from "@/lib/types";
import { readFormText } from "@/lib/validation";
import { SUPPORTED_LOCALES } from "@/lib/i18n";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const userSchema = z.object({ email: z.email(), displayName: z.string().trim().min(2).max(200),
  role: z.custom<UserRole>((value) => isUserRole(value), "Choose an approved account role."),
  companyId: z.uuid().optional(), branchId: z.uuid().optional(), departmentId: z.uuid().optional(), supplierId: z.uuid().optional(),
  jobTitle: z.string().trim().max(160).optional(),
  preferredLocale: z.enum(SUPPORTED_LOCALES) });

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
  await requireRecentStepUp(actor, "/users");
  const input = userSchema.parse({ email: readFormText(formData, "email"), displayName: readFormText(formData, "displayName"),
    role: readFormText(formData, "role"),
    companyId: readFormText(formData, "companyId") || undefined,
    branchId: readFormText(formData, "branchId") || undefined,
    departmentId: readFormText(formData, "departmentId") || undefined,
    supplierId: readFormText(formData, "supplierId") || undefined,
    jobTitle: readFormText(formData, "jobTitle") || undefined,
    preferredLocale: readFormText(formData, "preferredLocale") || "en" });
  let invitation: AccountSetupInvitationResult;
  try {
    invitation = await createInvitedUser(input, actor);
  } catch (error) {
    if (error instanceof AccountSetupInvitationQuotaError) {
      redirect(`/users?notice=${invitationQuotaNotice(error)}`);
    }
    throw error;
  }
  const delivery = await deliverInvitation(invitation);
  revalidatePath("/users");
  redirect(`/users?notice=${invitationNotice(delivery, "created")}`);
}

export async function resendAccountSetupInvitationAction(userId: string) {
  const actor = await requirePermission("manage_users");
  await requireRecentStepUp(actor, "/users");
  const safeUserId = z.uuid().parse(userId);
  let invitation: AccountSetupInvitationResult;
  try {
    invitation = await resendAccountSetupInvitation(safeUserId, actor);
  } catch (error) {
    if (error instanceof AccountSetupInvitationQuotaError) {
      redirect(`/users?notice=${invitationQuotaNotice(error)}`);
    }
    if (error instanceof AccountSetupResendRateLimitError) {
      redirect(`/users?notice=user-resend-${error.reason}`);
    }
    throw error;
  }
  const delivery = await deliverInvitation(invitation);
  revalidatePath("/users");
  redirect(`/users?notice=${invitationNotice(delivery, "resent")}`);
}

export async function setUserActiveAction(id: string, active: boolean) {
  const actor = await requirePermission("manage_users");
  await requireRecentStepUp(actor, "/users");
  await setAuthorizedUserActive(
    z.uuid().parse(id),
    z.boolean().parse(active),
    actor,
  );
  revalidatePath("/users");
}

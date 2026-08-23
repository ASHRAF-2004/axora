import { sendAccountSetupEmail } from "./account-email";
import {
  recordAccountSetupDelivery,
  type AccountSetupInvitationResult,
} from "./account-setup";
import {
  syncCompanyAdministrator,
} from "./company-lifecycle";
import { isDemoMode } from "./db";

export type AccountInvitationDeliveryOutcome =
  | "sent"
  | "disabled"
  | "failed"
  | "unconfirmed"
  | "sent-lifecycle-sync-failed";

/**
 * Canonical post-invitation boundary for every account creation and resend
 * entry point. A provider response is not treated as durable until the
 * invitation row records it, and Company Administrator lifecycle state is
 * synchronized only after that confirmed SENT transition.
 */
export async function deliverAccountSetupInvitation(
  invitation: AccountSetupInvitationResult,
  actor: Parameters<typeof syncCompanyAdministrator>[0],
): Promise<AccountInvitationDeliveryOutcome> {
  let delivery: Awaited<ReturnType<typeof sendAccountSetupEmail>>;
  try {
    delivery = await sendAccountSetupEmail(invitation);
  } catch {
    delivery = { succeeded: false, status: "failed" };
  }

  let deliveryRecorded = false;
  try {
    deliveryRecorded = await recordAccountSetupDelivery(invitation.invitationId, {
      succeeded: delivery.succeeded,
      providerMessageId: delivery.providerMessageId,
      providerName: delivery.providerName,
      status: delivery.status,
    });
  } catch {
    deliveryRecorded = false;
  }
  if (!deliveryRecorded) return "unconfirmed";
  if (!delivery.succeeded) {
    return delivery.status === "disabled" ? "disabled" : "failed";
  }

  if (invitation.role === "COMPANY_ADMIN" && invitation.companyId && !isDemoMode()) {
    try {
      await syncCompanyAdministrator(
        actor,
        invitation.companyId,
        "Secure Company Administrator invitation delivered",
      );
    } catch (error) {
      console.error(JSON.stringify({
        event: "company_administrator_lifecycle_sync_failed",
        invitationId: invitation.invitationId,
        companyId: invitation.companyId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }));
      return "sent-lifecycle-sync-failed";
    }
  }
  return "sent";
}

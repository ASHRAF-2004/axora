export const accountSetupDeliveryStatuses = [
  "PENDING",
  "SENDING",
  "SENT",
  "FAILED",
  "DISABLED",
  "UNCERTAIN",
  "CANCELLED",
] as const;

export type AccountSetupDeliveryStatus =
  (typeof accountSetupDeliveryStatuses)[number];

export type AccountSetupInvitationReplacementBlocker =
  | "pending"
  | "delivered"
  | "ineligible";

export function accountSetupInvitationReplacementBlocker(
  invitation: {
    currentInvitationPresent: boolean;
    deliveryStatus?: AccountSetupDeliveryStatus;
    expiresAt?: Date;
  },
  now = new Date(),
): AccountSetupInvitationReplacementBlocker | undefined {
  if (!invitation.currentInvitationPresent) return undefined;
  if (!invitation.deliveryStatus || !invitation.expiresAt
    || !Number.isFinite(invitation.expiresAt.getTime())
    || !Number.isFinite(now.getTime())) {
    return "ineligible";
  }
  if (invitation.expiresAt.getTime() <= now.getTime()) return undefined;
  if (["FAILED", "DISABLED", "UNCERTAIN", "CANCELLED"].includes(
    invitation.deliveryStatus,
  )) return undefined;
  if (["PENDING", "SENDING"].includes(invitation.deliveryStatus)) {
    return "pending";
  }
  if (invitation.deliveryStatus === "SENT") return "delivered";
  return "ineligible";
}

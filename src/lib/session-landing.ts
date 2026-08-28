import type { SessionUser } from "./auth";

type LandingSubject = Pick<SessionUser, "accountKind" | "isOwner" | "role">;

export function isDeliveryAgentSession(user: LandingSubject) {
  return user.accountKind === "DELIVERY" && [
    "DELIVERY_AGENT", "DELIVERY_DRIVER", "DELIVERY_GUY",
  ].includes(user.role);
}

export function landingPathForSession(user: LandingSubject) {
  if (isDeliveryAgentSession(user)) return "/driver";
  if (user.accountKind === "COMPANY" && user.role === "RECEIVING_USER") return "/requests";
  return "/dashboard";
}

import type { SessionUser } from "./auth";

type LandingSubject = Pick<SessionUser, "accountKind" | "isOwner" | "role">;

export function landingPathForSession(user: LandingSubject) {
  if (user.accountKind === "DELIVERY" && (
    user.role === "DELIVERY_DRIVER" || user.role === "DELIVERY_GUY"
  )) return "/driver";
  if (user.accountKind === "COMPANY" && user.role === "RECEIVING_USER") return "/receiving";
  return "/dashboard";
}

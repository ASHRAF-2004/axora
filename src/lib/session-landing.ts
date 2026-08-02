import type { SessionUser } from "./auth";

type LandingSubject = Pick<SessionUser, "accountKind" | "isOwner" | "role">;

export function landingPathForSession(user: LandingSubject) {
  if (user.accountKind === "SUPPLIER" && user.role === "SUPPLIER_USER") return "/supplier";
  if (user.accountKind === "DELIVERY" && user.role === "DELIVERY_DRIVER") return "/driver";
  if (user.accountKind === "COMPANY" && user.role === "RECEIVING_USER") return "/receiving";
  if (!user.isOwner && (user.role === "IT_SUPPORT" || user.role === "TECHNICAL_SUPPORT")) return "/support";
  return "/dashboard";
}

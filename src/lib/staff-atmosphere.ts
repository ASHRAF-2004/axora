import type { AuthenticatedSessionUser } from "./auth";
import { isDemoMode, query } from "./db";
import { PUBLIC_ATMOSPHERES, type PublicAtmosphere } from "./immersive-public-experience";

function isAtmosphere(value: unknown): value is PublicAtmosphere {
  return typeof value === "string" && PUBLIC_ATMOSPHERES.includes(value as PublicAtmosphere);
}

export function canChooseStaffAtmosphere(actor: AuthenticatedSessionUser) {
  return !actor.companyId && (actor.isOwner || actor.accountKind === "PLATFORM" || actor.accountKind === "DELIVERY");
}

export async function getStaffAtmosphere(actor: AuthenticatedSessionUser): Promise<PublicAtmosphere> {
  if (!canChooseStaffAtmosphere(actor) || isDemoMode()) return "Aurora";
  const result = await query<{ atmosphere: string | null }>(
    "SELECT public.axora_get_staff_atmosphere($1,$2) AS atmosphere",
    [actor.id, new Date()],
  );
  return isAtmosphere(result.rows[0]?.atmosphere) ? result.rows[0].atmosphere : "Aurora";
}

export async function setStaffAtmosphere(actor: AuthenticatedSessionUser, atmosphere: unknown) {
  if (!canChooseStaffAtmosphere(actor) || !isAtmosphere(atmosphere)) {
    throw new Error("Atmosphere preference unavailable.");
  }
  if (isDemoMode()) return atmosphere;
  const result = await query<{ atmosphere: string | null }>(
    "SELECT public.axora_set_staff_atmosphere($1,$2,$3) AS atmosphere",
    [actor.id, atmosphere, new Date()],
  );
  if (!isAtmosphere(result.rows[0]?.atmosphere)) throw new Error("Atmosphere preference unavailable.");
  return result.rows[0].atmosphere;
}

export const staffAtmosphereInternals = { isAtmosphere };

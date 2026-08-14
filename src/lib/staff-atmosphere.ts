import type { AuthenticatedSessionUser } from "./auth";
import { isDemoMode, query } from "./db";
import { PUBLIC_ATMOSPHERES, type PublicAtmosphere } from "./immersive-public-experience";

declare global {
  // Demo browser journeys have no database. Keeping this server-process scoped
  // preserves the same per-user contract without leaking a staff choice into
  // the public browser preference or another demo account.
  var __axoraDemoStaffAtmospheres: Map<string, PublicAtmosphere> | undefined;
}

function demoAtmospheres() {
  globalThis.__axoraDemoStaffAtmospheres ??= new Map<string, PublicAtmosphere>();
  return globalThis.__axoraDemoStaffAtmospheres;
}

function isAtmosphere(value: unknown): value is PublicAtmosphere {
  return typeof value === "string" && PUBLIC_ATMOSPHERES.includes(value as PublicAtmosphere);
}

export function canChooseStaffAtmosphere(actor: AuthenticatedSessionUser) {
  return !actor.companyId && (actor.isOwner || actor.accountKind === "PLATFORM" || actor.accountKind === "DELIVERY");
}

export async function getStaffAtmosphere(actor: AuthenticatedSessionUser): Promise<PublicAtmosphere> {
  if (!canChooseStaffAtmosphere(actor)) return "Aurora";
  if (isDemoMode()) return demoAtmospheres().get(actor.id) ?? "Aurora";
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
  if (isDemoMode()) {
    demoAtmospheres().set(actor.id, atmosphere);
    return atmosphere;
  }
  const result = await query<{ atmosphere: string | null }>(
    "SELECT public.axora_set_staff_atmosphere($1,$2,$3) AS atmosphere",
    [actor.id, atmosphere, new Date()],
  );
  if (!isAtmosphere(result.rows[0]?.atmosphere)) throw new Error("Atmosphere preference unavailable.");
  return result.rows[0].atmosphere;
}

export const staffAtmosphereInternals = { demoAtmospheres, isAtmosphere };

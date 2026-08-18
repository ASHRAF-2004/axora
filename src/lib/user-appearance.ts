import type { SessionUser } from "@/lib/auth";
import {
  DEFAULT_APPEARANCE,
  isAppearanceMode,
  type AppearanceMode,
} from "@/lib/appearance";
import { isDemoMode, query } from "@/lib/db";

const DEMO_APPEARANCE_KEY = Symbol.for("axora.demo.userAppearances");

type DemoGlobal = typeof globalThis & {
  [DEMO_APPEARANCE_KEY]?: Map<string, AppearanceMode>;
};

function demoAppearances() {
  const scoped = globalThis as DemoGlobal;
  scoped[DEMO_APPEARANCE_KEY] ??= new Map<string, AppearanceMode>();
  return scoped[DEMO_APPEARANCE_KEY];
}

export async function getUserAppearance(
  user: SessionUser,
  fallback: AppearanceMode = DEFAULT_APPEARANCE,
): Promise<AppearanceMode> {
  if (isDemoMode()) return demoAppearances().get(user.id) ?? fallback;

  const result = await query<{ appearance: string | null }>(
    "SELECT public.axora_get_user_appearance($1,$2) AS appearance",
    [user.id, new Date()],
  );
  const stored = result.rows[0]?.appearance;
  return isAppearanceMode(stored) ? stored : fallback;
}

export async function setUserAppearance(user: SessionUser, appearance: unknown): Promise<AppearanceMode> {
  if (!isAppearanceMode(appearance)) throw new Error("Invalid appearance preference");

  if (isDemoMode()) {
    demoAppearances().set(user.id, appearance);
    return appearance;
  }

  const result = await query<{ appearance: string }>(
    "SELECT public.axora_set_user_appearance($1,$2,$3) AS appearance",
    [user.id, appearance, new Date()],
  );
  const stored = result.rows[0]?.appearance;
  if (!isAppearanceMode(stored)) throw new Error("Appearance preference unavailable");
  return stored;
}

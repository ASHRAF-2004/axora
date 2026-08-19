export const APPEARANCE_MODES = ["light", "dark"] as const;

export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

export const DEFAULT_APPEARANCE: AppearanceMode = "light";
export const APPEARANCE_STORAGE_KEY = "axora-appearance:v1";
export const APPEARANCE_COOKIE_KEY = "axora_appearance";

// Rollout-only compatibility. New application state and writes use light/dark only.
export const LEGACY_APPEARANCE_STORAGE_KEY = "axora-public-atmosphere:v2";
export const LEGACY_APPEARANCE_COOKIE_KEY = "axora_public_atmosphere";

const LEGACY_APPEARANCE_MAP: Readonly<Record<string, AppearanceMode>> = {
  Aurora: "light",
  Solar: "light",
  Ember: "light",
  Midnight: "dark",
  aurora: "light",
  solar: "light",
  ember: "light",
  midnight: "dark",
};

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === "light" || value === "dark";
}

export function legacyAppearanceToMode(value: unknown): AppearanceMode | null {
  if (typeof value !== "string") return null;
  return LEGACY_APPEARANCE_MAP[value] ?? null;
}

export function resolveAppearanceMode(value: unknown, fallback: AppearanceMode = DEFAULT_APPEARANCE): AppearanceMode {
  return isAppearanceMode(value) ? value : fallback;
}

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  APPEARANCE_COOKIE_KEY,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  LEGACY_APPEARANCE_COOKIE_KEY,
  LEGACY_APPEARANCE_STORAGE_KEY,
  isAppearanceMode,
  legacyAppearanceToMode,
  type AppearanceMode,
} from "@/lib/appearance";

const AUTHENTICATED_AUTHORITY_SELECTOR = '[data-appearance-authority="authenticated"]';
const COOKIE_MAX_AGE_SECONDS = 31_536_000;

type AppearanceContextValue = {
  appearance: AppearanceMode;
  setAppearance: (value: AppearanceMode, persistPublicPreference?: boolean) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function setAppearanceCookie(value: AppearanceMode) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${APPEARANCE_COOKIE_KEY}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

function expireLegacyCookie() {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LEGACY_APPEARANCE_COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function cookieValue(name: string) {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) ?? null;
}

function persistPublicAppearance(value: AppearanceMode) {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, value);
    window.localStorage.removeItem(LEGACY_APPEARANCE_STORAGE_KEY);
  } catch {
    // Cookie persistence remains available when storage is blocked.
  }
  setAppearanceCookie(value);
  expireLegacyCookie();
}

function migrateLegacyBrowserPreference(serverAppearance: AppearanceMode): AppearanceMode {
  const currentCookie = cookieValue(APPEARANCE_COOKIE_KEY);
  const legacyCookie = cookieValue(LEGACY_APPEARANCE_COOKIE_KEY);
  let currentStorage: string | null = null;
  let legacyStorage: string | null = null;
  try {
    currentStorage = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    legacyStorage = window.localStorage.getItem(LEGACY_APPEARANCE_STORAGE_KEY);
  } catch {
    // Storage is optional; the SSR-readable cookie remains authoritative.
  }

  // The server-rendered cookie is the first-paint authority. Keep localStorage
  // synchronized with it instead of allowing a stale cache to repaint the page.
  if (isAppearanceMode(currentCookie) || legacyAppearanceToMode(legacyCookie)) {
    persistPublicAppearance(serverAppearance);
    return serverAppearance;
  }

  // A storage-only legacy preference can happen after manual cookie clearing.
  // Migrate it once, then establish the new SSR-readable cookie contract.
  const storageOnly = isAppearanceMode(currentStorage)
    ? currentStorage
    : legacyAppearanceToMode(legacyStorage);
  const resolved = storageOnly ?? serverAppearance;
  persistPublicAppearance(resolved);
  return resolved;
}

export function AppearanceProvider({
  initialAppearance = DEFAULT_APPEARANCE,
  children,
}: {
  initialAppearance?: AppearanceMode;
  children: ReactNode;
}) {
  const [appearance, setAppearanceState] = useState<AppearanceMode>(initialAppearance);

  const applyAppearance = useCallback((value: AppearanceMode) => {
    setAppearanceState(value);
    document.documentElement.dataset.appearance = value;
  }, []);

  const setAppearance = useCallback((value: AppearanceMode, persistPublicPreference = true) => {
    applyAppearance(value);
    if (persistPublicPreference) persistPublicAppearance(value);
  }, [applyAppearance]);

  useLayoutEffect(() => {
    if (document.querySelector(AUTHENTICATED_AUTHORITY_SELECTOR)) return;
    const resolved = migrateLegacyBrowserPreference(initialAppearance);
    if (resolved === initialAppearance) return;
    const frame = window.requestAnimationFrame(() => applyAppearance(resolved));
    return () => window.cancelAnimationFrame(frame);
  }, [applyAppearance, initialAppearance]);

  useLayoutEffect(() => {
    const sync = (event: StorageEvent) => {
      if (document.querySelector(AUTHENTICATED_AUTHORITY_SELECTOR)) return;
      if (event.key === APPEARANCE_STORAGE_KEY && isAppearanceMode(event.newValue)) {
        applyAppearance(event.newValue);
        setAppearanceCookie(event.newValue);
        return;
      }
      if (event.key === LEGACY_APPEARANCE_STORAGE_KEY) {
        const migrated = legacyAppearanceToMode(event.newValue);
        if (!migrated) return;
        applyAppearance(migrated);
        persistPublicAppearance(migrated);
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [applyAppearance]);

  const value = useMemo(() => ({ appearance, setAppearance }), [appearance, setAppearance]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("useAppearance must be used within AppearanceProvider");
  return context;
}

export const appearanceProviderInternals = {
  authenticatedAuthoritySelector: AUTHENTICATED_AUTHORITY_SELECTOR,
  cookieKey: APPEARANCE_COOKIE_KEY,
  storageKey: APPEARANCE_STORAGE_KEY,
  legacyCookieKey: LEGACY_APPEARANCE_COOKIE_KEY,
  legacyStorageKey: LEGACY_APPEARANCE_STORAGE_KEY,
};

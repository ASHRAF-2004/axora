"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { PUBLIC_ATMOSPHERES, type PublicAtmosphere } from "@/lib/immersive-public-experience";

const PUBLIC_STORAGE_KEY = "axora-public-atmosphere:v2";
const PUBLIC_COOKIE_KEY = "axora_public_atmosphere";
const AUTHENTICATED_AUTHORITY_SELECTOR = '[data-atmosphere-authority="authenticated"]';

type AtmosphereContextValue = {
  atmosphere: PublicAtmosphere;
  setAtmosphere: (value: PublicAtmosphere, persistPublic?: boolean) => void;
};

const AtmosphereContext = createContext<AtmosphereContextValue | null>(null);

function validAtmosphere(value: unknown): value is PublicAtmosphere {
  return typeof value === "string" && PUBLIC_ATMOSPHERES.includes(value as PublicAtmosphere);
}

export function AtmosphereProvider({
  children,
  initialAtmosphere = "Aurora",
}: {
  children: ReactNode;
  initialAtmosphere?: PublicAtmosphere;
}) {
  const [atmosphere, setCurrent] = useState<PublicAtmosphere>(initialAtmosphere);

  const setAtmosphere = useCallback((value: PublicAtmosphere, persistPublic = true) => {
    setCurrent(value);
    document.documentElement.dataset.atmosphere = value.toLowerCase();
    if (!persistPublic) return;
    try { window.localStorage.setItem(PUBLIC_STORAGE_KEY, value); } catch { /* Optional preference storage. */ }
    document.cookie = `${PUBLIC_COOKIE_KEY}=${value.toLowerCase()}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
  }, []);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      // Authenticated shells own their theme. Restoring a public preference
      // here would race the server-persisted staff preference and could also
      // leak a visitor atmosphere into a company-branded portal.
      if (document.querySelector(AUTHENTICATED_AUTHORITY_SELECTOR)) return;
      let saved: string | null = null;
      try { saved = window.localStorage.getItem(PUBLIC_STORAGE_KEY); } catch { /* Use the server-rendered value. */ }
      setAtmosphere(validAtmosphere(saved) ? saved : initialAtmosphere, false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialAtmosphere, setAtmosphere]);

  useEffect(() => {
    function synchronize(event: StorageEvent) {
      if (event.key === PUBLIC_STORAGE_KEY && validAtmosphere(event.newValue)) {
        setAtmosphere(event.newValue, false);
      }
    }
    window.addEventListener("storage", synchronize);
    return () => window.removeEventListener("storage", synchronize);
  }, [setAtmosphere]);

  const value = useMemo(() => ({ atmosphere, setAtmosphere }), [atmosphere, setAtmosphere]);
  return <AtmosphereContext.Provider value={value}>{children}</AtmosphereContext.Provider>;
}

export function useAtmosphere() {
  const value = useContext(AtmosphereContext);
  if (!value) throw new Error("Atmosphere controls require AtmosphereProvider.");
  return value;
}

export const atmosphereProviderInternals = {
  AUTHENTICATED_AUTHORITY_SELECTOR,
  PUBLIC_COOKIE_KEY,
  PUBLIC_STORAGE_KEY,
  validAtmosphere,
};

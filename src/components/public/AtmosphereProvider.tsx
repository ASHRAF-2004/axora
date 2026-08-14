"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { PUBLIC_ATMOSPHERES, type PublicAtmosphere } from "@/lib/immersive-public-experience";

const PUBLIC_STORAGE_KEY = "axora-public-atmosphere:v2";

type AtmosphereContextValue = {
  atmosphere: PublicAtmosphere;
  setAtmosphere: (value: PublicAtmosphere, persistPublic?: boolean) => void;
};

const AtmosphereContext = createContext<AtmosphereContextValue | null>(null);

function validAtmosphere(value: unknown): value is PublicAtmosphere {
  return typeof value === "string" && PUBLIC_ATMOSPHERES.includes(value as PublicAtmosphere);
}

export function AtmosphereProvider({ children }: { children: ReactNode }) {
  const [atmosphere, setCurrent] = useState<PublicAtmosphere>("Aurora");

  const setAtmosphere = useCallback((value: PublicAtmosphere, persistPublic = true) => {
    setCurrent(value);
    document.documentElement.dataset.atmosphere = value.toLowerCase();
    if (!persistPublic) return;
    try { window.localStorage.setItem(PUBLIC_STORAGE_KEY, value); } catch { /* Optional preference storage. */ }
  }, []);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(PUBLIC_STORAGE_KEY); } catch { /* Use the default. */ }
    const frame = window.requestAnimationFrame(() => {
      setAtmosphere(validAtmosphere(saved) ? saved : "Aurora", false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [setAtmosphere]);

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

export const atmosphereProviderInternals = { PUBLIC_STORAGE_KEY, validAtmosphere };

"use client";

import { useEffect, useRef } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { PUBLIC_ATMOSPHERES, type PublicAtmosphere } from "@/lib/immersive-public-experience";
import { useAtmosphere } from "./AtmosphereProvider";
import styles from "./ImmersiveWorld.module.css";

const labels: Record<PublicAtmosphere, { en: string; ar: string; ms: string }> = {
  Aurora: { en: "Aurora", ar: "الشفق", ms: "Aurora" },
  Solar: { en: "Solar", ar: "شمسي", ms: "Suria" },
  Ember: { en: "Ember", ar: "الجمر", ms: "Bara" },
  Midnight: { en: "Midnight", ar: "منتصف الليل", ms: "Tengah malam" },
};

export function AtmosphereSelector({
  compact = false,
  showThemes = true,
  locale = "en",
  staffUserId,
  initialAtmosphere,
  onThemeSelect,
  soundEnabled,
  onSoundToggle,
}: {
  compact?: boolean;
  showThemes?: boolean;
  locale?: "en" | "ar" | "ms";
  staffUserId?: string;
  initialAtmosphere?: PublicAtmosphere;
  onThemeSelect?: () => void;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
}) {
  const { atmosphere, setAtmosphere } = useAtmosphere();
  const initialized = useRef(false);

  useEffect(() => {
    if (!staffUserId || !initialAtmosphere || initialized.current) return;
    initialized.current = true;
    setAtmosphere(initialAtmosphere, false);
  }, [initialAtmosphere, setAtmosphere, staffUserId]);

  async function select(next: PublicAtmosphere) {
    if (next === atmosphere) return;
    setAtmosphere(next, !staffUserId);
    onThemeSelect?.();
    if (!staffUserId) return;
    try {
      await fetch("/api/profile/atmosphere", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atmosphere: next }),
      });
    } catch {
      // The visual choice remains available for this session; server state is
      // authoritative on the next authenticated load.
    }
  }

  const title = locale === "ar" ? "الأجواء" : locale === "ms" ? "Suasana" : "Atmosphere";
  return <fieldset className={compact ? styles.atmosphereCompact : styles.atmosphereSelector}>
    <legend className={compact ? "sr-only" : undefined}>{title}</legend>
    {showThemes ? PUBLIC_ATMOSPHERES.map((item) => <button
      aria-pressed={atmosphere === item}
      data-selected={atmosphere === item}
      key={item}
      onClick={() => void select(item)}
      title={`${title}: ${labels[item][locale]}`}
      type="button"
    >
      <span aria-hidden="true" data-swatch={item.toLowerCase()} />
      {compact ? <span className="sr-only">{labels[item][locale]}</span> : labels[item][locale]}
    </button>) : null}
    {onSoundToggle ? <button aria-pressed={Boolean(soundEnabled)} className={styles.soundToggle} onClick={onSoundToggle} type="button">
      {soundEnabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
      <span>{soundEnabled ? (locale === "ar" ? "كتم صوت الواجهة" : locale === "ms" ? "Senyapkan bunyi antara muka" : "Mute interface sound") : (locale === "ar" ? "تشغيل صوت الواجهة" : locale === "ms" ? "Hidupkan bunyi antara muka" : "Enable interface sound")}</span>
    </button> : null}
  </fieldset>;
}

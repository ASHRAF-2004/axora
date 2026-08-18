"use client";

import { Moon, Sun, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { APPEARANCE_MODES, type AppearanceMode } from "@/lib/appearance";
import { appearanceMessages } from "@/lib/appearance-i18n";
import type { SupportedLocale } from "@/lib/i18n";
import { useAppearance } from "./AppearanceProvider";
import styles from "./ImmersiveWorld.module.css";

export function AppearanceSelector({
  compact = false,
  showModes = true,
  locale = "en",
  appearance: controlledAppearance,
  onAppearanceChange,
  onModeSelect,
  soundEnabled,
  onSoundToggle,
}: {
  compact?: boolean;
  showModes?: boolean;
  locale?: SupportedLocale;
  appearance?: AppearanceMode;
  onAppearanceChange?: (appearance: AppearanceMode) => Promise<boolean | void> | boolean | void;
  onModeSelect?: (appearance: AppearanceMode) => void;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
}) {
  const publicAppearance = useAppearance();
  const currentAppearance = controlledAppearance ?? publicAppearance.appearance;
  const copy = appearanceMessages(locale);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function selectAppearance(next: AppearanceMode) {
    if (next === currentAppearance || saving) return;
    setFailed(false);
    if (!onAppearanceChange) {
      publicAppearance.setAppearance(next);
      onModeSelect?.(next);
      return;
    }

    setSaving(true);
    try {
      const result = await onAppearanceChange(next);
      if (result === false) throw new Error("appearance update rejected");
      onModeSelect?.(next);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`${styles.atmosphereControls} ${compact ? styles.compactControls : ""}`} data-appearance-control>
      {showModes ? (
        <fieldset className={styles.themeFieldset} disabled={saving} data-persistence-state={failed ? "failed" : saving ? "saving" : "ready"}>
          <legend>{copy.appearance}</legend>
          <div className={styles.themeOptions} role="group" aria-label={copy.appearance}>
            {APPEARANCE_MODES.map((mode) => {
              const selected = currentAppearance === mode;
              const label = mode === "light" ? copy.light : copy.dark;
              const Icon = mode === "light" ? Sun : Moon;
              return (
                <button
                  key={mode}
                  type="button"
                  data-appearance-choice={mode}
                  aria-pressed={selected}
                  aria-label={`${copy.appearance}: ${label}`}
                  title={label}
                  onClick={() => void selectAppearance(mode)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
          {failed ? <span className={styles.controlError} role="alert">{copy.saveFailed}</span> : null}
        </fieldset>
      ) : null}
      {onSoundToggle ? (
        <button
          type="button"
          className={styles.soundToggle}
          aria-pressed={soundEnabled}
          onClick={onSoundToggle}
          aria-label={soundEnabled ? (locale === "ar" ? "إيقاف الصوت" : locale === "ms" ? "Matikan bunyi" : "Mute interface sound") : (locale === "ar" ? "تشغيل الصوت" : locale === "ms" ? "Hidupkan bunyi" : "Enable interface sound")}
        >
          {soundEnabled ? <Volume2 size={17} aria-hidden="true" /> : <VolumeX size={17} aria-hidden="true" />}
        </button>
      ) : null}
    </div>
  );
}

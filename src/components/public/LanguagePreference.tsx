"use client";

import { Check, Languages, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  LOCALE_COOKIE,
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@/lib/i18n";

interface LanguagePreferenceProps {
  locale: SupportedLocale;
  detectedLocale: SupportedLocale;
  prompt: boolean;
  labels: {
    label: string;
    detectedTitle: string;
    detectedBody: string;
    continue: string;
    choose: string;
    close: string;
  };
  compact?: boolean;
}

function localizedPath(pathname: string, locale: SupportedLocale) {
  const segments = pathname.split("/");
  if (SUPPORTED_LOCALES.includes(segments[1] as SupportedLocale)) segments[1] = locale;
  else segments.splice(1, 0, locale);
  return segments.join("/") || `/${locale}`;
}

export function LanguagePreference({
  locale,
  detectedLocale,
  prompt,
  labels,
  compact = false,
}: LanguagePreferenceProps) {
  const pathname = usePathname();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [showPrompt, setShowPrompt] = useState(prompt);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (showPrompt && dialog && !dialog.open) dialog.showModal();
  }, [showPrompt]);

  function remember(nextLocale: SupportedLocale) {
    document.cookie = `${LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    setShowPrompt(false);
    dialogRef.current?.close();
    router.replace(localizedPath(pathname, nextLocale));
  }

  return (
    <>
      <label className={`public-language-select${compact ? " public-language-compact" : ""}`}>
        <Languages size={17} aria-hidden="true" />
        <span className="sr-only">{labels.label}</span>
        <select
          aria-label={labels.label}
          value={locale}
          onChange={(event) => remember(event.target.value as SupportedLocale)}
        >
          {SUPPORTED_LOCALES.map((option) => (
            <option key={option} value={option}>{LOCALE_NAMES[option].native}</option>
          ))}
        </select>
      </label>

      {showPrompt ? (
        <dialog
          ref={dialogRef}
          className="language-dialog"
          aria-labelledby="language-dialog-title"
          onCancel={() => setShowPrompt(false)}
          onClose={() => setShowPrompt(false)}
        >
          <button
            type="button"
            className="language-dialog-close"
            aria-label={labels.close}
            onClick={() => dialogRef.current?.close()}
          >
            <X size={19} aria-hidden="true" />
          </button>
          <div className="language-dialog-icon"><Languages size={24} aria-hidden="true" /></div>
          <h2 id="language-dialog-title">{labels.detectedTitle}</h2>
          <p>{labels.detectedBody}</p>
          <button className="button button-primary button-full" type="button" onClick={() => remember(detectedLocale)}>
            <Check size={17} aria-hidden="true" />
            {labels.continue} — {LOCALE_NAMES[detectedLocale].native}
          </button>
          <div className="language-dialog-options" role="group" aria-label={labels.choose}>
            {SUPPORTED_LOCALES.filter((option) => option !== detectedLocale).map((option) => (
              <button key={option} type="button" onClick={() => remember(option)}>
                {LOCALE_NAMES[option].native}
                <small>{LOCALE_NAMES[option].english}</small>
              </button>
            ))}
          </div>
        </dialog>
      ) : null}
    </>
  );
}

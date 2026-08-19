import type { SupportedLocale } from "@/lib/i18n";

const APPEARANCE_COPY = {
  en: {
    appearance: "Appearance",
    light: "Light",
    dark: "Dark",
    saveFailed: "Appearance could not be saved. Please try again.",
  },
  ar: {
    appearance: "المظهر",
    light: "فاتح",
    dark: "داكن",
    saveFailed: "تعذر حفظ المظهر. حاول مرة أخرى.",
  },
  ms: {
    appearance: "Penampilan",
    light: "Cerah",
    dark: "Gelap",
    saveFailed: "Penampilan tidak dapat disimpan. Cuba lagi.",
  },
} as const;

export function appearanceMessages(locale: SupportedLocale) {
  return APPEARANCE_COPY[locale];
}

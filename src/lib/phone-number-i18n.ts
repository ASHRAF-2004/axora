import type { SupportedLocale } from "@/lib/i18n";

const messages = {
  en: {
    chooseCountry: "Choose country",
    searchCountry: "Search countries or dial codes",
    noCountries: "No matching countries",
    nationalNumber: "National number",
    help: "Choose a country, then enter the national number. It is saved in international format.",
    required: "Enter a phone number.",
    invalid: "Enter a valid phone number for the selected country.",
    characters: "Use digits and standard phone punctuation only.",
    duplicate: "Enter the country calling code only once.",
  },
  ar: {
    chooseCountry: "اختر الدولة",
    searchCountry: "ابحث عن دولة أو رمز اتصال",
    noCountries: "لا توجد دول مطابقة",
    nationalNumber: "الرقم المحلي",
    help: "اختر الدولة ثم أدخل الرقم المحلي. يُحفظ الرقم بالتنسيق الدولي.",
    required: "أدخل رقم هاتف.",
    invalid: "أدخل رقم هاتف صالحاً للدولة المحددة.",
    characters: "استخدم الأرقام وعلامات ترقيم الهاتف المعتادة فقط.",
    duplicate: "أدخل رمز اتصال الدولة مرة واحدة فقط.",
  },
  ms: {
    chooseCountry: "Pilih negara",
    searchCountry: "Cari negara atau kod dail",
    noCountries: "Tiada negara yang sepadan",
    nationalNumber: "Nombor tempatan",
    help: "Pilih negara, kemudian masukkan nombor tempatan. Nombor disimpan dalam format antarabangsa.",
    required: "Masukkan nombor telefon.",
    invalid: "Masukkan nombor telefon yang sah untuk negara dipilih.",
    characters: "Gunakan digit dan tanda baca telefon standard sahaja.",
    duplicate: "Masukkan kod panggilan negara sekali sahaja.",
  },
} as const;

export function phoneNumberMessages(locale: SupportedLocale = "en") {
  return messages[locale];
}

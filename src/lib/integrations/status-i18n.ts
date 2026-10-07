import type { SupportedLocale } from "../i18n";

const messages = {
  en: {
    zapierDisabled: "Zapier disabled", zapierAvailable: "Zapier available", zapierSetup: "Zapier requires setup",
    capabilityHelp: "Available or enabled adapters are not connected accounts. Connections and delivery status are listed below.",
    providerOAuth: "Provider-managed OAuth", adapterAvailable: "Adapter available",
    providerHelp: "This built-in adapter is configured through its provider workspace above, not an Axora API client. Availability does not mean a workspace is connected.",
  },
  ar: {
    zapierDisabled: "Zapier معطّل", zapierAvailable: "Zapier متاح", zapierSetup: "Zapier يحتاج إلى إعداد",
    capabilityHelp: "الموصلات المتاحة أو المفعّلة ليست حسابات متصلة. تُعرض الاتصالات وحالة التسليم أدناه.",
    providerOAuth: "OAuth يديره المزوّد", adapterAvailable: "الموصل متاح",
    providerHelp: "يُهيّأ هذا الموصل المدمج من مساحة عمل المزوّد أعلاه، وليس كعميل لواجهة API الخاصة بأكسورا. إتاحته لا تعني اتصال مساحة عمل.",
  },
  ms: {
    zapierDisabled: "Zapier dinyahdayakan", zapierAvailable: "Zapier tersedia", zapierSetup: "Zapier memerlukan persediaan",
    capabilityHelp: "Penyesuai yang tersedia atau didayakan bukan akaun yang bersambung. Sambungan dan status penghantaran disenaraikan di bawah.",
    providerOAuth: "OAuth diurus penyedia", adapterAvailable: "Penyesuai tersedia",
    providerHelp: "Penyesuai terbina dalam ini dikonfigurasi melalui ruang kerja penyedianya di atas, bukan sebagai klien API Axora. Ketersediaan tidak bermakna ruang kerja telah bersambung.",
  },
} as const;

export function integrationStatusMessages(locale: SupportedLocale) { return messages[locale]; }

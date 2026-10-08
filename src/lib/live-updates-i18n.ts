import type { SupportedLocale } from "./i18n";

const messages = {
  en: {
    liveCurrent: "Live updates connected",
    liveReconnecting: "Live updates reconnecting; displayed data may be stale",
    livePolling: "Live updates unavailable; polling for changes",
    livePaused: "Live updates paused while offline or hidden",
    liveDeferred: "New data is available; finish your changes to update this view",
  },
  ar: {
    liveCurrent: "التحديثات المباشرة متصلة",
    liveReconnecting: "تجري إعادة الاتصال بالتحديثات المباشرة؛ قد تكون البيانات المعروضة قديمة",
    livePolling: "التحديثات المباشرة غير متاحة؛ يجري التحقق من التغييرات دورياً",
    livePaused: "التحديثات المباشرة متوقفة أثناء عدم الاتصال أو إخفاء الصفحة",
    liveDeferred: "تتوفر بيانات جديدة؛ أكمل تعديلاتك لتحديث هذا العرض",
  },
  ms: {
    liveCurrent: "Kemas kini langsung disambungkan",
    liveReconnecting: "Menyambung semula kemas kini langsung; data yang dipaparkan mungkin lapuk",
    livePolling: "Kemas kini langsung tidak tersedia; menyemak perubahan secara berkala",
    livePaused: "Kemas kini langsung dijeda ketika luar talian atau halaman tersembunyi",
    liveDeferred: "Data baharu tersedia; selesaikan perubahan anda untuk mengemas kini paparan ini",
  },
};
export function liveUpdatesMessages(locale: SupportedLocale) { return messages[locale]; }

import type { SupportedLocale } from "./i18n";

interface RequestFilterMessages {
  title: string; description: string; search: string; searchPlaceholder: string;
  status: string; allStatuses: string; openOnly: string; apply: string; clearAll: string;
  resultCount: (total: number) => string;
  resultRange: (from: number, to: number, total: number) => string;
  previous: string; next: string; page: (page: number, pages: number) => string;
  noMatches: string; noScopeRows: string;
}

const en: RequestFilterMessages = {
  title: "Find purchase requests", description: "Search by request or product, then narrow by status.",
  search: "Search requests", searchPlaceholder: "Request number or product", status: "Filter by status",
  allStatuses: "All statuses", openOnly: "Open only", apply: "Apply", clearAll: "Clear",
  resultCount: (total) => `${total.toLocaleString()} requests`,
  resultRange: (from, to, total) => total ? `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}` : "No results",
  previous: "Previous", next: "Next", page: (page, pages) => `Page ${page} of ${pages}`,
  noMatches: "No requests match this search.", noScopeRows: "No purchase requests are available in your scope.",
};
const ar: RequestFilterMessages = {
  title: "البحث في طلبات الشراء", description: "ابحث بالطلب أو المنتج ثم حدد الحالة.",
  search: "البحث في الطلبات", searchPlaceholder: "رقم الطلب أو المنتج", status: "التصفية حسب الحالة",
  allStatuses: "كل الحالات", openOnly: "المفتوحة فقط", apply: "تطبيق", clearAll: "مسح",
  resultCount: (total) => `${total.toLocaleString("ar")} طلب`,
  resultRange: (from, to, total) => total ? `${from.toLocaleString("ar")}–${to.toLocaleString("ar")} من ${total.toLocaleString("ar")}` : "لا توجد نتائج",
  previous: "السابق", next: "التالي", page: (page, pages) => `الصفحة ${page} من ${pages}`,
  noMatches: "لا توجد طلبات مطابقة لهذا البحث.", noScopeRows: "لا توجد طلبات شراء متاحة ضمن نطاقك.",
};
const ms: RequestFilterMessages = {
  title: "Cari permintaan pembelian", description: "Cari mengikut permintaan atau produk, kemudian tapis mengikut status.",
  search: "Cari permintaan", searchPlaceholder: "Nombor permintaan atau produk", status: "Tapis mengikut status",
  allStatuses: "Semua status", openOnly: "Terbuka sahaja", apply: "Gunakan", clearAll: "Kosongkan",
  resultCount: (total) => `${total.toLocaleString("ms")} permintaan`,
  resultRange: (from, to, total) => total ? `${from.toLocaleString("ms")}–${to.toLocaleString("ms")} daripada ${total.toLocaleString("ms")}` : "Tiada hasil",
  previous: "Sebelumnya", next: "Seterusnya", page: (page, pages) => `Halaman ${page} daripada ${pages}`,
  noMatches: "Tiada permintaan sepadan dengan carian ini.", noScopeRows: "Tiada permintaan pembelian tersedia dalam skop anda.",
};

const messages: Record<SupportedLocale, RequestFilterMessages> = { en, ar, ms };
export function requestFilterMessages(locale: SupportedLocale = "en") { return messages[locale]; }
export const REQUEST_FILTER_MESSAGES = messages;

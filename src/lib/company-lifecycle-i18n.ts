import type { SupportedLocale } from "./i18n";
import type { CompanyLifecycleStatus } from "./company-lifecycle";

const en = {
  eyebrow: "Companies", title: "Companies", description: "Create a company directly and continue its setup in one clear workspace.",
  register: "Company register", createTitle: "Add company", createIntro: "Enter the essential details. A reviewed logo can be added now or later.",
  count: "{count} companies", countOne: "{count} company", allStatuses: "All statuses", filter: "Filter", noCompanies: "No companies match your search.",
  displayName: "Company name", legalName: "Legal name (optional)", industry: "Industry (optional)", website: "Website (optional)",
  logo: "Logo (optional)", logoHelp: "PNG, JPEG or WebP up to 2 MB. Axora uses fallback branding until a reviewed logo is available.",
  mainContact: "Main contact name", submit: "Create company", status: "Status",
  continueSetup: "Continue setup", back: "Back to companies",
  creationCommandConflict: "This creation request was already used with different details. Review the form and try again.",
} as const;

type Copy = { [K in keyof typeof en]: string };
const ar: Copy = {
  eyebrow: "الشركات", title: "الشركات", description: "أنشئ الشركة مباشرة وأكمل إعدادها في مساحة عمل واضحة.",
  register: "سجل الشركات", createTitle: "إضافة شركة", createIntro: "أدخل المعلومات الأساسية. يمكن إضافة شعار مراجع الآن أو لاحقاً.",
  count: "{count} شركة", countOne: "{count} شركة", allStatuses: "كل الحالات", filter: "تصفية", noCompanies: "لا توجد شركات مطابقة للبحث.",
  displayName: "اسم الشركة", legalName: "الاسم القانوني (اختياري)", industry: "القطاع (اختياري)", website: "الموقع الإلكتروني (اختياري)",
  logo: "الشعار (اختياري)", logoHelp: "PNG أو JPEG أو WebP حتى 2 ميجابايت. تستخدم أكسورا الهوية الافتراضية حتى اعتماد الشعار.",
  mainContact: "اسم جهة الاتصال الرئيسية", submit: "إنشاء الشركة", status: "الحالة",
  continueSetup: "متابعة الإعداد", back: "العودة إلى الشركات",
  creationCommandConflict: "استُخدم طلب الإنشاء هذا بتفاصيل مختلفة. راجع النموذج وحاول مجدداً.",
};
const ms: Copy = {
  eyebrow: "Syarikat", title: "Syarikat", description: "Cipta syarikat secara langsung dan teruskan persediaannya dalam satu ruang kerja yang jelas.",
  register: "Daftar syarikat", createTitle: "Tambah syarikat", createIntro: "Masukkan butiran penting. Logo yang disemak boleh ditambah sekarang atau kemudian.",
  count: "{count} syarikat", countOne: "{count} syarikat", allStatuses: "Semua status", filter: "Tapis", noCompanies: "Tiada syarikat sepadan dengan carian.",
  displayName: "Nama syarikat", legalName: "Nama sah (pilihan)", industry: "Industri (pilihan)", website: "Laman web (pilihan)",
  logo: "Logo (pilihan)", logoHelp: "PNG, JPEG atau WebP sehingga 2 MB. Axora menggunakan penjenamaan lalai sehingga logo disemak.",
  mainContact: "Nama hubungan utama", submit: "Cipta syarikat", status: "Status",
  continueSetup: "Teruskan persediaan", back: "Kembali ke syarikat",
  creationCommandConflict: "Permintaan penciptaan ini telah digunakan dengan butiran lain. Semak borang dan cuba lagi.",
};

const catalogs: Record<SupportedLocale, Copy> = { en, ar, ms };
const statusLabels: Record<SupportedLocale, Record<CompanyLifecycleStatus, string>> = {
  en: { NEW_LEAD: "Historical", UNDER_REVIEW: "Setup", ASSIGNED: "Setup", CONTACTED: "Setup", INFORMATION_PENDING: "Setup", ONBOARDING: "Setup", PORTAL_DRAFT: "Setup", COMPANY_REVIEW: "Review", COMPANY_ADMINISTRATOR_INVITED: "Administrator invited", COMPANY_ADMINISTRATOR_ACTIVATED: "Administrator active", ACTIVE: "Active", DUPLICATE: "Needs review", REJECTED: "Inactive", INACTIVE: "Inactive", SUSPENDED: "Suspended", ARCHIVED: "Archived" },
  ar: { NEW_LEAD: "تاريخي", UNDER_REVIEW: "إعداد", ASSIGNED: "إعداد", CONTACTED: "إعداد", INFORMATION_PENDING: "إعداد", ONBOARDING: "إعداد", PORTAL_DRAFT: "إعداد", COMPANY_REVIEW: "مراجعة", COMPANY_ADMINISTRATOR_INVITED: "دُعي المدير", COMPANY_ADMINISTRATOR_ACTIVATED: "المدير نشط", ACTIVE: "نشطة", DUPLICATE: "تحتاج مراجعة", REJECTED: "غير نشطة", INACTIVE: "غير نشطة", SUSPENDED: "معلقة", ARCHIVED: "مؤرشفة" },
  ms: { NEW_LEAD: "Sejarah", UNDER_REVIEW: "Persediaan", ASSIGNED: "Persediaan", CONTACTED: "Persediaan", INFORMATION_PENDING: "Persediaan", ONBOARDING: "Persediaan", PORTAL_DRAFT: "Persediaan", COMPANY_REVIEW: "Semakan", COMPANY_ADMINISTRATOR_INVITED: "Pentadbir dijemput", COMPANY_ADMINISTRATOR_ACTIVATED: "Pentadbir aktif", ACTIVE: "Aktif", DUPLICATE: "Perlu semakan", REJECTED: "Tidak aktif", INACTIVE: "Tidak aktif", SUSPENDED: "Digantung", ARCHIVED: "Diarkib" },
};

const statusFilterGroups = [
  {
    value: "SETUP",
    statuses: [
      "NEW_LEAD", "UNDER_REVIEW", "ASSIGNED", "CONTACTED",
      "INFORMATION_PENDING", "ONBOARDING", "PORTAL_DRAFT",
    ],
  },
  { value: "REVIEW", statuses: ["COMPANY_REVIEW"] },
  { value: "ADMINISTRATOR_INVITED", statuses: ["COMPANY_ADMINISTRATOR_INVITED"] },
  { value: "ADMINISTRATOR_ACTIVE", statuses: ["COMPANY_ADMINISTRATOR_ACTIVATED"] },
  { value: "ACTIVE", statuses: ["ACTIVE"] },
  { value: "NEEDS_REVIEW", statuses: ["DUPLICATE"] },
  { value: "INACTIVE", statuses: ["REJECTED", "INACTIVE"] },
  { value: "SUSPENDED", statuses: ["SUSPENDED"] },
] as const satisfies readonly {
  value: string;
  statuses: readonly CompanyLifecycleStatus[];
}[];

type StatusFilterValue = (typeof statusFilterGroups)[number]["value"];
const statusFilterLabels: Record<SupportedLocale, Record<StatusFilterValue, string>> = {
  en: {
    SETUP: "Setup",
    REVIEW: "Company review",
    ADMINISTRATOR_INVITED: "Administrator invited",
    ADMINISTRATOR_ACTIVE: "Administrator active",
    ACTIVE: "Active",
    NEEDS_REVIEW: "Needs review",
    INACTIVE: "Inactive",
    SUSPENDED: "Suspended",
  },
  ar: {
    SETUP: "قيد الإعداد",
    REVIEW: "مراجعة الشركة",
    ADMINISTRATOR_INVITED: "تمت دعوة المسؤول",
    ADMINISTRATOR_ACTIVE: "المسؤول نشط",
    ACTIVE: "نشطة",
    NEEDS_REVIEW: "تحتاج مراجعة",
    INACTIVE: "غير نشطة",
    SUSPENDED: "معلقة",
  },
  ms: {
    SETUP: "Persediaan",
    REVIEW: "Semakan syarikat",
    ADMINISTRATOR_INVITED: "Pentadbir dijemput",
    ADMINISTRATOR_ACTIVE: "Pentadbir aktif",
    ACTIVE: "Aktif",
    NEEDS_REVIEW: "Perlu semakan",
    INACTIVE: "Tidak aktif",
    SUSPENDED: "Digantung",
  },
};

export function companyLifecycleMessages(locale: SupportedLocale) { return catalogs[locale]; }
export function companyLifecycleText(locale: SupportedLocale, key: keyof Copy, values: Record<string, string | number> = {}) {
  return Object.entries(values).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), catalogs[locale][key]);
}
export function companyLifecycleStatusLabel(locale: SupportedLocale, status: CompanyLifecycleStatus) { return statusLabels[locale][status]; }
export function companyLifecycleCountText(locale: SupportedLocale, count: number) {
  return companyLifecycleText(locale, count === 1 ? "countOne" : "count", { count });
}
export function companyLifecycleStatusFilters(locale: SupportedLocale) {
  return statusFilterGroups.map((group) => ({
    value: group.value,
    statuses: group.statuses,
    label: statusFilterLabels[locale][group.value],
  }));
}
export function resolveCompanyLifecycleStatusFilter(raw: string | undefined) {
  if (!raw) return undefined;
  return statusFilterGroups.find((group) => (
    group.value === raw || group.statuses.some((status) => status === raw)
  ));
}

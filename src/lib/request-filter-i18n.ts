import type { SupportedLocale } from "./i18n";
import type { RequestBudgetExceptionStatus, RequestSort } from "./request-filters";

interface RequestFilterMessages {
  title: string;
  description: string;
  search: string;
  searchPlaceholder: string;
  status: string;
  allStatuses: string;
  openOnly: string;
  category: string;
  company: string;
  manager: string;
  branch: string;
  department: string;
  costCentre: string;
  requester: string;
  approver: string;
  deliveryAgent: string;
  supplier: string;
  budgetException: string;
  noBudgetFilter: string;
  advanced: string;
  neededFrom: string;
  neededTo: string;
  submittedFrom: string;
  submittedTo: string;
  approvedFrom: string;
  approvedTo: string;
  completedFrom: string;
  completedTo: string;
  minAmount: string;
  maxAmount: string;
  sort: string;
  pageSize: string;
  apply: string;
  clearAll: string;
  activeFilters: string;
  remove: (label: string) => string;
  find: (label: string) => string;
  selectedValue: string;
  loading: string;
  loadError: string;
  retry: string;
  noOptions: string;
  optionCount: (count: number) => string;
  resultCount: (total: number) => string;
  resultRange: (from: number, to: number, total: number) => string;
  previous: string;
  next: string;
  page: (page: number, pages: number) => string;
  noMatches: string;
  noScopeRows: string;
  budgetStatuses: Record<RequestBudgetExceptionStatus, string>;
  sorts: Record<RequestSort, string>;
}

const en: RequestFilterMessages = {
  title: "Find purchase requests",
  description: "Combine only the filters available inside your current role and organization scope.",
  search: "Search requests",
  searchPlaceholder: "Request number or product text",
      status: "Filter by status",
  allStatuses: "All statuses",
  openOnly: "Open only",
  category: "Request category",
  company: "Company",
  manager: "Client Account Manager",
  branch: "Branch",
  department: "Department",
  costCentre: "Cost centre",
  requester: "Requester",
  approver: "Approver",
  deliveryAgent: "Delivery Agent",
  supplier: "Supplier",
  budgetException: "Budget exception",
  noBudgetFilter: "Any budget status",
  advanced: "Organization, people, dates, and amount",
  neededFrom: "Required from",
  neededTo: "Required to",
  submittedFrom: "Submitted from",
  submittedTo: "Submitted to",
  approvedFrom: "Approved from",
  approvedTo: "Approved to",
  completedFrom: "Completed from",
  completedTo: "Completed to",
  minAmount: "Minimum amount",
  maxAmount: "Maximum amount",
  sort: "Sort requests",
  pageSize: "Rows per page",
  apply: "Apply filters",
  clearAll: "Clear all",
  activeFilters: "Active filters",
  remove: (label) => `Remove ${label} filter`,
  find: (label) => `Find ${label}`,
  selectedValue: "Selected authorized value",
  loading: "Loading authorized options...",
  loadError: "Authorized options could not be loaded. Existing selections were preserved.",
  retry: "Retry",
  noOptions: "No authorized options found.",
  optionCount: (count) => `${count.toLocaleString()} requests`,
  resultCount: (total) => `${total.toLocaleString()} authorized requests`,
  resultRange: (from, to, total) => `Showing ${from.toLocaleString()}-${to.toLocaleString()} of ${total.toLocaleString()}`,
  previous: "Previous page",
  next: "Next page",
  page: (page, pages) => `Page ${page.toLocaleString()} of ${pages.toLocaleString()}`,
  noMatches: "No authorized purchase requests match these filters.",
  noScopeRows: "No purchase requests are available in your current scope.",
  budgetStatuses: {
    NONE: "No exception", ACTIVE: "Active exception", BUDGET_AVAILABLE: "Budget unavailable",
    COMPANY_CEILING: "Company ceiling", APPROVAL_LIMIT: "Approval limit",
    ADDITIONAL_ACTUAL: "Additional actual cost", RESOLVED: "Resolved exception",
  },
  sorts: {
    "submitted-desc": "Newest submitted", "submitted-asc": "Oldest submitted",
    "needed-asc": "Required soonest", "needed-desc": "Required latest",
    "amount-desc": "Amount: high to low", "amount-asc": "Amount: low to high",
  },
};

const ar: RequestFilterMessages = {
  title: "البحث في طلبات الشراء",
  description: "ادمج فقط عوامل التصفية المتاحة ضمن دورك ونطاق مؤسستك الحالي.",
  search: "البحث في الطلبات",
  searchPlaceholder: "رقم الطلب أو نص المنتج",
  status: "حالة الطلب",
  allStatuses: "كل الحالات",
  openOnly: "المفتوحة فقط",
  category: "فئة الطلب",
  company: "الشركة",
  manager: "مدير حساب العميل",
  branch: "الفرع",
  department: "القسم",
  costCentre: "مركز التكلفة",
  requester: "مقدم الطلب",
  approver: "المعتمد",
  deliveryAgent: "مندوب التسليم",
  supplier: "المورد",
  budgetException: "استثناء الميزانية",
  noBudgetFilter: "أي حالة ميزانية",
  advanced: "المؤسسة والأشخاص والتواريخ والمبلغ",
  neededFrom: "مطلوب من",
  neededTo: "مطلوب إلى",
  submittedFrom: "مقدم من",
  submittedTo: "مقدم إلى",
  approvedFrom: "معتمد من",
  approvedTo: "معتمد إلى",
  completedFrom: "مكتمل من",
  completedTo: "مكتمل إلى",
  minAmount: "الحد الأدنى للمبلغ",
  maxAmount: "الحد الأعلى للمبلغ",
  sort: "ترتيب الطلبات",
  pageSize: "صفوف كل صفحة",
  apply: "تطبيق عوامل التصفية",
  clearAll: "مسح الكل",
  activeFilters: "عوامل التصفية النشطة",
  remove: (label) => `إزالة عامل تصفية ${label}`,
  find: (label) => `البحث عن ${label}`,
  selectedValue: "قيمة مصرح بها محددة",
  loading: "جارٍ تحميل الخيارات المصرح بها...",
  loadError: "تعذر تحميل الخيارات المصرح بها. تم الاحتفاظ بالتحديدات الحالية.",
  retry: "إعادة المحاولة",
  noOptions: "لا توجد خيارات مصرح بها.",
  optionCount: (count) => `${count.toLocaleString("ar-MY")} طلبات`,
  resultCount: (total) => `${total.toLocaleString("ar-MY")} طلبات مصرح بها`,
  resultRange: (from, to, total) => `عرض ${from.toLocaleString("ar-MY")}-${to.toLocaleString("ar-MY")} من ${total.toLocaleString("ar-MY")}`,
  previous: "الصفحة السابقة",
  next: "الصفحة التالية",
  page: (page, pages) => `الصفحة ${page.toLocaleString("ar-MY")} من ${pages.toLocaleString("ar-MY")}`,
  noMatches: "لا توجد طلبات شراء مصرح بها تطابق عوامل التصفية.",
  noScopeRows: "لا توجد طلبات شراء متاحة ضمن نطاقك الحالي.",
  budgetStatuses: {
    NONE: "بلا استثناء", ACTIVE: "استثناء نشط", BUDGET_AVAILABLE: "الميزانية غير متاحة",
    COMPANY_CEILING: "سقف الشركة", APPROVAL_LIMIT: "حد الاعتماد",
    ADDITIONAL_ACTUAL: "تكلفة فعلية إضافية", RESOLVED: "استثناء محلول",
  },
  sorts: {
    "submitted-desc": "الأحدث تقديماً", "submitted-asc": "الأقدم تقديماً",
    "needed-asc": "الأقرب طلباً", "needed-desc": "الأبعد طلباً",
    "amount-desc": "المبلغ: من الأعلى", "amount-asc": "المبلغ: من الأقل",
  },
};

const ms: RequestFilterMessages = {
  title: "Cari permintaan pembelian",
  description: "Gabungkan hanya penapis yang tersedia dalam skop peranan dan organisasi semasa anda.",
  search: "Cari permintaan",
  searchPlaceholder: "Nombor permintaan atau teks produk",
  status: "Status permintaan",
  allStatuses: "Semua status",
  openOnly: "Terbuka sahaja",
  category: "Kategori permintaan",
  company: "Syarikat",
  manager: "Pengurus Akaun Pelanggan",
  branch: "Cawangan",
  department: "Jabatan",
  costCentre: "Pusat kos",
  requester: "Peminta",
  approver: "Pelulus",
  deliveryAgent: "Ejen Penghantaran",
  supplier: "Pembekal",
  budgetException: "Pengecualian bajet",
  noBudgetFilter: "Sebarang status bajet",
  advanced: "Organisasi, individu, tarikh dan amaun",
  neededFrom: "Diperlukan dari",
  neededTo: "Diperlukan hingga",
  submittedFrom: "Dihantar dari",
  submittedTo: "Dihantar hingga",
  approvedFrom: "Diluluskan dari",
  approvedTo: "Diluluskan hingga",
  completedFrom: "Selesai dari",
  completedTo: "Selesai hingga",
  minAmount: "Amaun minimum",
  maxAmount: "Amaun maksimum",
  sort: "Susun permintaan",
  pageSize: "Baris setiap halaman",
  apply: "Gunakan penapis",
  clearAll: "Kosongkan semua",
  activeFilters: "Penapis aktif",
  remove: (label) => `Buang penapis ${label}`,
  find: (label) => `Cari ${label}`,
  selectedValue: "Nilai dibenarkan yang dipilih",
  loading: "Memuatkan pilihan yang dibenarkan...",
  loadError: "Pilihan yang dibenarkan tidak dapat dimuatkan. Pilihan sedia ada dikekalkan.",
  retry: "Cuba semula",
  noOptions: "Tiada pilihan dibenarkan ditemui.",
  optionCount: (count) => `${count.toLocaleString("ms-MY")} permintaan`,
  resultCount: (total) => `${total.toLocaleString("ms-MY")} permintaan dibenarkan`,
  resultRange: (from, to, total) => `Menunjukkan ${from.toLocaleString("ms-MY")}-${to.toLocaleString("ms-MY")} daripada ${total.toLocaleString("ms-MY")}`,
  previous: "Halaman sebelumnya",
  next: "Halaman seterusnya",
  page: (page, pages) => `Halaman ${page.toLocaleString("ms-MY")} daripada ${pages.toLocaleString("ms-MY")}`,
  noMatches: "Tiada permintaan pembelian dibenarkan sepadan dengan penapis ini.",
  noScopeRows: "Tiada permintaan pembelian tersedia dalam skop semasa anda.",
  budgetStatuses: {
    NONE: "Tiada pengecualian", ACTIVE: "Pengecualian aktif", BUDGET_AVAILABLE: "Bajet tidak tersedia",
    COMPANY_CEILING: "Siling syarikat", APPROVAL_LIMIT: "Had kelulusan",
    ADDITIONAL_ACTUAL: "Kos sebenar tambahan", RESOLVED: "Pengecualian diselesaikan",
  },
  sorts: {
    "submitted-desc": "Terbaharu dihantar", "submitted-asc": "Terlama dihantar",
    "needed-asc": "Diperlukan terawal", "needed-desc": "Diperlukan terkemudian",
    "amount-desc": "Amaun: tinggi ke rendah", "amount-asc": "Amaun: rendah ke tinggi",
  },
};

const messages: Record<SupportedLocale, RequestFilterMessages> = { en, ar, ms };
export function requestFilterMessages(locale: SupportedLocale = "en") {
  return messages[locale];
}

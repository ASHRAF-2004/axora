import type { PermissionCode } from "./authorization-policy";
import type { SupportedLocale } from "./i18n";

export interface LocalizablePermissionOption {
  code: PermissionCode;
  group: string;
  label: string;
  description: string;
  highRisk: boolean;
}

const groups = {
  ar: {
    Navigation: "التنقل", Platform: "المنصة", Companies: "الشركات",
    People: "الأشخاص", Organization: "هيكل الشركة", Catalogue: "الكتالوج",
    Requests: "الطلبات", Approvals: "الموافقات", Budgets: "الميزانيات",
    Commercial: "الشؤون التجارية", Delivery: "التسليم", Receiving: "الاستلام",
    Finance: "المالية", Documents: "المستندات", Reporting: "التقارير",
    Analytics: "التحليلات", Email: "البريد الإلكتروني", Audit: "التدقيق",
    Settings: "الإعدادات", Support: "الدعم", Supplier: "الموردون",
    Procurement: "المشتريات",
    "Platform people": "مستخدمو أكسورا", "Company people": "مستخدمو الشركة",
    "Delivery people": "مستخدمو التسليم", "Financial visibility": "الرؤية المالية",
  },
  ms: {
    Navigation: "Navigasi", Platform: "Platform", Companies: "Syarikat",
    People: "Pengguna", Organization: "Struktur syarikat", Catalogue: "Katalog",
    Requests: "Permintaan", Approvals: "Kelulusan", Budgets: "Bajet",
    Commercial: "Komersial", Delivery: "Penghantaran", Receiving: "Penerimaan",
    Finance: "Kewangan", Documents: "Dokumen", Reporting: "Pelaporan",
    Analytics: "Analitik", Email: "E-mel", Audit: "Audit",
    Settings: "Tetapan", Support: "Sokongan", Supplier: "Pembekal",
    Procurement: "Perolehan",
    "Platform people": "Pengguna Axora", "Company people": "Pengguna syarikat",
    "Delivery people": "Pengguna penghantaran", "Financial visibility": "Keterlihatan kewangan",
  },
} as const;

const resources = {
  dashboard: { ar: "لوحة المعلومات", ms: "papan pemuka" },
  platform: { ar: "المنصة", ms: "platform" },
  company: { ar: "الشركات", ms: "syarikat" },
  "company.lead": { ar: "العملاء المحتملين", ms: "prospek syarikat" },
  "company.portal": { ar: "بوابة الشركة", ms: "portal syarikat" },
  user: { ar: "المستخدمين", ms: "pengguna" },
  "organization.branch": { ar: "الفروع", ms: "cawangan" },
  "organization.department": { ar: "الأقسام", ms: "jabatan" },
  "organization.cost_center": { ar: "مراكز التكلفة", ms: "pusat kos" },
  "organization.delivery_location": { ar: "مواقع التسليم", ms: "lokasi penghantaran" },
  product: { ar: "المنتجات", ms: "produk" },
  catalog: { ar: "الكتالوج", ms: "katalog" },
  cart: { ar: "سلة التسوق", ms: "troli" },
  request: { ar: "طلبات الشراء", ms: "permintaan pembelian" },
  "request.approval_queue": { ar: "قائمة انتظار الموافقات", ms: "baris gilir kelulusan" },
  budget: { ar: "الميزانيات", ms: "bajet" },
  "budget.branch": { ar: "ميزانيات الفروع", ms: "bajet cawangan" },
  "commercial.cost": { ar: "تكلفة الشراء", ms: "kos belian" },
  "commercial.markup": { ar: "هامش الربح", ms: "tokokan" },
  "commercial.company_ceiling": { ar: "السقف التعاقدي للشركة", ms: "had kontrak syarikat" },
  "commercial.platform_margin": { ar: "هامش المنصة", ms: "margin platform" },
  "commercial.pricing": { ar: "التسعير التجاري", ms: "harga komersial" },
  delivery: { ar: "عمليات التسليم", ms: "penghantaran" },
  "delivery.receipt": { ar: "إيصالات التسليم", ms: "resit penghantaran" },
  "delivery.portal": { ar: "بوابة التسليم", ms: "portal penghantaran" },
  "delivery.assignment": { ar: "مهام التسليم", ms: "tugasan penghantaran" },
  "delivery.tracking": { ar: "تتبع التسليم", ms: "penjejakan penghantaran" },
  receiving: { ar: "الاستلام", ms: "penerimaan" },
  finance: { ar: "العمليات المالية", ms: "operasi kewangan" },
  "finance.invoice": { ar: "الفواتير", ms: "invois" },
  "finance.wallet": { ar: "محفظة الشركة", ms: "Dompet Syarikat" },
  "finance.wallet.top_up": { ar: "شحن محفظة الشركة", ms: "tambah nilai Dompet Syarikat" },
  document: { ar: "المستندات", ms: "dokumen" },
  report: { ar: "التقارير", ms: "laporan" },
  "analytics.platform": { ar: "تحليلات المنصة", ms: "analitik platform" },
  "analytics.company": { ar: "تحليلات الشركة", ms: "analitik syarikat" },
  "analytics.revenue": { ar: "الإيرادات", ms: "hasil" },
  "email.operations": { ar: "عمليات البريد الإلكتروني", ms: "operasi e-mel" },
  audit: { ar: "سجل التدقيق", ms: "jejak audit" },
  settings: { ar: "الإعدادات", ms: "tetapan" },
  "system.diagnostics": { ar: "تشخيصات النظام", ms: "diagnostik sistem" },
  "supplier.portal": { ar: "بوابة المورد", ms: "portal pembekal" },
  "supplier.rfq": { ar: "طلبات عروض الأسعار", ms: "permintaan sebut harga" },
  platform_user: { ar: "مستخدمي أكسورا", ms: "pengguna Axora" },
  company_user: { ar: "مستخدمي الشركة", ms: "pengguna syarikat" },
  delivery_user: { ar: "مستخدمي التسليم", ms: "pengguna penghantaran" },
  category: { ar: "فئات المنتجات", ms: "kategori produk" },
  "procurement.category_policy": { ar: "سياسة فئات الشراء", ms: "polisi kategori pembelian" },
} as const;

const actions = {
  view: { ar: "عرض", ms: "Lihat" },
  viewAssigned: { ar: "عرض العناصر المسندة من", ms: "Lihat tugasan dalam" },
  viewOwn: { ar: "عرض العناصر الخاصة ضمن", ms: "Lihat item sendiri dalam" },
  viewAll: { ar: "عرض جميع", ms: "Lihat semua" },
  create: { ar: "إنشاء", ms: "Cipta" },
  edit: { ar: "تعديل", ms: "Edit" },
  invite: { ar: "دعوة", ms: "Jemput" },
  deactivate: { ar: "تعطيل", ms: "Nyahaktifkan" },
  manage: { ar: "إدارة", ms: "Urus" },
  managePermissions: { ar: "إدارة صلاحيات", ms: "Urus kebenaran" },
  assign: { ar: "إسناد", ms: "Tugaskan" },
  reassign: { ar: "إعادة إسناد", ms: "Tugaskan semula" },
  activate: { ar: "تفعيل", ms: "Aktifkan" },
  suspend: { ar: "تعليق", ms: "Gantung" },
  preview: { ar: "معاينة", ms: "Pratonton" },
  publish: { ar: "نشر", ms: "Terbitkan" },
  submit: { ar: "إرسال", ms: "Hantar" },
  cancel: { ar: "إلغاء", ms: "Batalkan" },
  approveOther: { ar: "الموافقة على طلبات الآخرين ضمن", ms: "Luluskan permintaan orang lain dalam" },
  approveSelf: { ar: "الموافقة الذاتية ضمن", ms: "Luluskan permintaan sendiri dalam" },
  approveOverBudget: { ar: "الموافقة على تجاوز الميزانية ضمن", ms: "Luluskan lebihan bajet dalam" },
  approveAdditionalActual: { ar: "الموافقة على التكلفة الفعلية الإضافية ضمن", ms: "Luluskan kos sebenar tambahan dalam" },
  increase: { ar: "زيادة", ms: "Tambah" },
  reduce: { ar: "تخفيض", ms: "Kurangkan" },
  refresh: { ar: "تجديد", ms: "Segar semula" },
  override: { ar: "تجاوز", ms: "Atasi" },
  accept: { ar: "قبول", ms: "Terima" },
  shop: { ar: "تسجيل التسوق ضمن", ms: "Rekod pembelian dalam" },
  upload: { ar: "رفع", ms: "Muat naik" },
  track: { ar: "تحديث تتبع", ms: "Kemas kini penjejakan" },
  complete: { ar: "إكمال", ms: "Lengkapkan" },
  update: { ar: "تحديث", ms: "Kemas kini" },
  confirm: { ar: "تأكيد", ms: "Sahkan" },
  generate: { ar: "إنشاء", ms: "Jana" },
  download: { ar: "تنزيل", ms: "Muat turun" },
  dispatchCompany: { ar: "إرسال إلى الشركة", ms: "Hantar kepada syarikat" },
  respond: { ar: "الرد على", ms: "Balas" },
  request: { ar: "طلب", ms: "Mohon" },
  record: { ar: "تسجيل", ms: "Rekod" },
  claim: { ar: "استلام", ms: "Tuntut" },
  history: { ar: "عرض سجل", ms: "Lihat sejarah" },
  archive: { ar: "أرشفة", ms: "Arkibkan" },
} as const;

type LocalizedAction = keyof typeof actions;

function permissionParts(code: PermissionCode): {
  resource: keyof typeof resources;
  action: LocalizedAction;
} | null {
  const special: Array<[string, LocalizedAction]> = [
    [".permission.manage", "managePermissions"],
    [".view.assigned", "viewAssigned"],
    [".view.own", "viewOwn"],
    [".view.all", "viewAll"],
    [".approve.additional_actual", "approveAdditionalActual"],
    [".approve.over_budget", "approveOverBudget"],
    [".approve.other", "approveOther"],
    [".approve.self", "approveSelf"],
    [".dispatch.company", "dispatchCompany"],
  ];
  for (const [suffix, action] of special) {
    if (code.endsWith(suffix)) {
      const resource = code.slice(0, -suffix.length) as keyof typeof resources;
      return resource in resources ? { resource, action } : null;
    }
  }
  const separator = code.lastIndexOf(".");
  if (separator < 1) return null;
  const resource = code.slice(0, separator) as keyof typeof resources;
  const action = code.slice(separator + 1) as LocalizedAction;
  return resource in resources && action in actions ? { resource, action } : null;
}

export function localizePermissionOption<T extends LocalizablePermissionOption>(
  option: T,
  locale: SupportedLocale,
): T {
  if (locale === "en") return option;
  const parts = permissionParts(option.code);
  const translatedGroup = groups[locale][option.group as keyof typeof groups[typeof locale]]
    ?? (locale === "ar" ? "صلاحيات أخرى" : "Kebenaran lain");
  const label = parts
    ? `${actions[parts.action][locale]} ${resources[parts.resource][locale]}`
    : locale === "ar" ? `صلاحية تشغيلية (${option.code})`
      : `Kebenaran operasi (${option.code})`;
  const description = locale === "ar"
    ? `يسمح بـ«${label}» ضمن نطاق الحساب والموارد المصرح به فقط.`
    : `Membenarkan “${label}” dalam skop akaun dan sumber yang dibenarkan sahaja.`;
  return { ...option, group: translatedGroup, label, description };
}

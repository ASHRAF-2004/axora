import type { SupportedLocale } from "./i18n";

const en = {
  "common.status": "Status",
  "finance.platformEyebrow": "Finance control", "finance.companyEyebrow": "Company billing", "finance.platformTitle": "Invoices and payments", "finance.companyTitle": "Your invoices and payment receipts", "finance.platformDescription": "Axora records invoice and payment evidence. It does not process online payments.", "finance.companyDescription": "Review invoices and payment records available to your company.",
  "finance.invoiceRegister": "Invoice register", "finance.invoiceCount": "{count} invoices", "finance.invoice": "Invoice", "finance.directionRequest": "Direction / request", "finance.counterparty": "Counterparty", "finance.dateDue": "Date / due", "finance.amount": "Amount", "finance.paid": "Paid", "finance.outstanding": "Outstanding", "finance.request": "Request", "finance.due": "Due {date}", "finance.paymentRegister": "Payment register", "finance.paymentIntro": "Payment evidence", "finance.date": "Date", "finance.reference": "Reference", "finance.recordedBy": "Recorded by",
  "finance.customer": "Customer", "finance.supplier": "Supplier",
  "access.eyebrow": "Access control", "access.title": "This page is not part of your role", "access.description": "Your account is signed in, but it does not have permission to open this workspace.", "access.none": "No data was shown", "access.body": "Use the navigation available to your role. Ask an administrator if your responsibilities have changed.", "access.dashboard": "Back to dashboard", "access.settings": "Open settings",
} as const;

type Dictionary = Record<keyof typeof en, string>;
const ar: Dictionary = {
  "common.status": "الحالة",
  "finance.platformEyebrow": "الرقابة المالية", "finance.companyEyebrow": "فواتير الشركة", "finance.platformTitle": "الفواتير والمدفوعات", "finance.companyTitle": "فواتيرك وإيصالات الدفع", "finance.platformDescription": "تسجل أكسورا أدلة الفواتير والمدفوعات ولا تعالج المدفوعات عبر الإنترنت.", "finance.companyDescription": "راجع الفواتير وسجلات الدفع المتاحة لشركتك.",
  "finance.invoiceRegister": "سجل الفواتير", "finance.invoiceCount": "{count} فواتير", "finance.invoice": "الفاتورة", "finance.directionRequest": "الاتجاه / الطلب", "finance.counterparty": "الطرف المقابل", "finance.dateDue": "التاريخ / الاستحقاق", "finance.amount": "المبلغ", "finance.paid": "مدفوع", "finance.outstanding": "مستحق", "finance.request": "الطلب", "finance.due": "يستحق {date}", "finance.paymentRegister": "سجل المدفوعات", "finance.paymentIntro": "أدلة الدفع", "finance.date": "التاريخ", "finance.reference": "المرجع", "finance.recordedBy": "سجله",
  "finance.customer": "العميل", "finance.supplier": "المورد",
  "access.eyebrow": "التحكم بالوصول", "access.title": "هذه الصفحة ليست ضمن دورك", "access.description": "حسابك مسجل الدخول لكنه لا يملك صلاحية فتح هذه المساحة.", "access.none": "لم تعرض أي بيانات", "access.body": "استخدم التنقل المتاح لدورك واسأل المسؤول إذا تغيرت مهامك.", "access.dashboard": "العودة إلى اللوحة", "access.settings": "فتح الإعدادات",
};
const ms: Dictionary = {
  "common.status": "Status",
  "finance.platformEyebrow": "Kawalan kewangan", "finance.companyEyebrow": "Pengebilan syarikat", "finance.platformTitle": "Invois dan bayaran", "finance.companyTitle": "Invois dan resit bayaran anda", "finance.platformDescription": "Axora merekod bukti invois dan bayaran. Ia tidak memproses bayaran dalam talian.", "finance.companyDescription": "Semak invois dan rekod bayaran yang tersedia untuk syarikat anda.",
  "finance.invoiceRegister": "Daftar invois", "finance.invoiceCount": "{count} invois", "finance.invoice": "Invois", "finance.directionRequest": "Arah / permintaan", "finance.counterparty": "Pihak lawan", "finance.dateDue": "Tarikh / matang", "finance.amount": "Amaun", "finance.paid": "Dibayar", "finance.outstanding": "Belum dibayar", "finance.request": "Permintaan", "finance.due": "Matang {date}", "finance.paymentRegister": "Daftar bayaran", "finance.paymentIntro": "Bukti bayaran", "finance.date": "Tarikh", "finance.reference": "Rujukan", "finance.recordedBy": "Direkod oleh",
  "finance.customer": "Pelanggan", "finance.supplier": "Pembekal",
  "access.eyebrow": "Kawalan akses", "access.title": "Halaman ini bukan sebahagian peranan anda", "access.description": "Akaun anda telah log masuk tetapi tiada kebenaran membuka ruang ini.", "access.none": "Tiada data dipaparkan", "access.body": "Gunakan navigasi untuk peranan anda dan tanya pentadbir jika tanggungjawab berubah.", "access.dashboard": "Kembali ke papan pemuka", "access.settings": "Buka tetapan",
};

const dictionaries: Record<SupportedLocale, Dictionary> = { en, ar, ms };
export type OperationalMessageKey = keyof typeof en;

export function operationalMessage(locale: SupportedLocale, key: OperationalMessageKey, values: Record<string, string | number> = {}) {
  const template = dictionaries[locale][key];
  return Object.entries(values).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), template);
}

const statuses: Record<SupportedLocale, Record<string, string>> = {
  en: {},
  ar: { Active:"نشط", Inactive:"غير نشط", Selected:"مختار", Approved:"معتمد", Pending:"معلق", Issued:"صادرة", Paid:"مدفوعة", Unpaid:"غير مدفوعة", Matched:"مطابق", EXCEPTION:"استثناء", NOT_READY:"غير جاهز", MATCHED:"مطابق", Delivered:"مُسلّم", Delayed:"متأخر", Cancelled:"ملغي", Failed:"فشل", Assigned:"مسند", Accepted:"مقبول" },
  ms: { Active:"Aktif", Inactive:"Tidak aktif", Selected:"Dipilih", Approved:"Diluluskan", Pending:"Menunggu", Issued:"Dikeluarkan", Paid:"Dibayar", Unpaid:"Belum dibayar", Matched:"Sepadan", EXCEPTION:"Pengecualian", NOT_READY:"Belum sedia", MATCHED:"Sepadan", Delivered:"Dihantar", Delayed:"Lewat", Cancelled:"Dibatalkan", Failed:"Gagal", Assigned:"Ditugaskan", Accepted:"Diterima" },
};

export function operationalStatus(locale: SupportedLocale, status: string) {
  return statuses[locale][status] ?? status.replaceAll("_", " ");
}

export function operationalNumber(locale: SupportedLocale, value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-MY" : locale === "ms" ? "ms-MY" : "en-MY", options).format(value);
}

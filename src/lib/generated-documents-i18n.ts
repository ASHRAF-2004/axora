import type { SupportedLocale } from "./i18n";

const messages = {
  en: {
    eyebrow: "Controlled documents", title: "Versioned procurement records",
    intro: "Immutable approval, fulfilment and supplier order PDFs with live access checks.",
    generated: "Generated documents", generation: "Generation queue",
    purchaseOrders: "Supplier purchase orders", contacts: "Verified supplier contact",
    request: "Request", type: "Type", supplier: "Supplier", version: "Version",
    status: "Status", generatedAt: "Generated", file: "File", attempts: "Attempts",
    retry: "Retry information", actions: "Actions", download: "Secure download",
    pending: "Working...", refreshing: "Refreshing document job status...", reference: "Job reference",
    jobStatuses: { PENDING: "Queued", PROCESSING: "Processing", RETRY: "Retry scheduled", COMPLETED: "Completed", FAILED: "Failed", CANCELLED: "Cancelled" },
    noDocuments: "No generated documents are available in your current scope.",
    noJobs: "No document jobs are visible in your current scope.",
    noOrders: "No supplier purchase orders are visible in your current scope.",
    regenerate: "Regenerate", correct: "Create corrected version", reason: "Reason",
    ready: "Ready for sales review", approve: "Approve for dispatch", dispatch: "Dispatch secure link",
    resend: "Resend secure link", amend: "Create amendment", cancel: "Cancel order",
    acknowledge: "Acknowledge purchase order", warnings: "Warnings",
    noContact: "No active, verified and unsuppressed supplier contact is available.",
    history: "Every replacement preserves the prior version and checksum.",
    failure: "Enqueue failures", pages: "pages", bytes: "bytes",
    notices: {
      queued: "A new immutable document version was queued.",
      "po-updated": "The supplier purchase order state was updated.",
    } as Record<string, string>,
  },
  ar: {
    eyebrow: "مستندات خاضعة للرقابة", title: "سجلات مشتريات متعددة الإصدارات",
    intro: "ملفات موافقة وتجهيز وأوامر شراء غير قابلة للتغيير مع فحص مباشر للصلاحيات.",
    generated: "المستندات المنشأة", generation: "قائمة انتظار الإنشاء",
    purchaseOrders: "أوامر شراء الموردين", contacts: "جهة اتصال مورد موثقة",
    request: "الطلب", type: "النوع", supplier: "المورد", version: "الإصدار",
    status: "الحالة", generatedAt: "تاريخ الإنشاء", file: "الملف", attempts: "المحاولات",
    retry: "معلومات إعادة المحاولة", actions: "الإجراءات", download: "تنزيل آمن",
    pending: "جارٍ التنفيذ...", refreshing: "جارٍ تحديث حالة مهمة المستند...", reference: "مرجع المهمة",
    jobStatuses: { PENDING: "في قائمة الانتظار", PROCESSING: "قيد المعالجة", RETRY: "إعادة المحاولة مجدولة", COMPLETED: "مكتملة", FAILED: "فشلت", CANCELLED: "ملغاة" },
    noDocuments: "لا توجد مستندات منشأة ضمن نطاقك الحالي.",
    noJobs: "لا توجد مهام مستندات ظاهرة ضمن نطاقك الحالي.",
    noOrders: "لا توجد أوامر شراء موردين ظاهرة ضمن نطاقك الحالي.",
    regenerate: "إعادة الإنشاء", correct: "إنشاء إصدار مصحح", reason: "السبب",
    ready: "جاهز لمراجعة المبيعات", approve: "اعتماد للإرسال", dispatch: "إرسال الرابط الآمن",
    resend: "إعادة إرسال الرابط الآمن", amend: "إنشاء تعديل", cancel: "إلغاء الأمر",
    acknowledge: "تأكيد استلام أمر الشراء", warnings: "التنبيهات",
    noContact: "لا توجد جهة اتصال نشطة وموثقة وغير محظورة لهذا المورد.",
    history: "يحافظ كل استبدال على الإصدار السابق وبصمته.",
    failure: "إخفاقات الإدراج", pages: "صفحات", bytes: "بايت",
    notices: {
      queued: "تمت إضافة إصدار مستند غير قابل للتغيير إلى قائمة الانتظار.",
      "po-updated": "تم تحديث حالة أمر شراء المورد.",
    } as Record<string, string>,
  },
  ms: {
    eyebrow: "Dokumen terkawal", title: "Rekod perolehan berversi",
    intro: "PDF kelulusan, pemenuhan dan pesanan pembekal kekal dengan semakan akses langsung.",
    generated: "Dokumen dijana", generation: "Baris gilir penjanaan",
    purchaseOrders: "Pesanan pembelian pembekal", contacts: "Hubungan pembekal disahkan",
    request: "Permintaan", type: "Jenis", supplier: "Pembekal", version: "Versi",
    status: "Status", generatedAt: "Dijana", file: "Fail", attempts: "Percubaan",
    retry: "Maklumat cuba semula", actions: "Tindakan", download: "Muat turun selamat",
    pending: "Sedang diproses...", refreshing: "Menyegarkan status tugas dokumen...", reference: "Rujukan tugas",
    jobStatuses: { PENDING: "Dalam giliran", PROCESSING: "Sedang diproses", RETRY: "Cuba semula dijadualkan", COMPLETED: "Selesai", FAILED: "Gagal", CANCELLED: "Dibatalkan" },
    noDocuments: "Tiada dokumen dijana tersedia dalam skop semasa anda.",
    noJobs: "Tiada tugas dokumen kelihatan dalam skop semasa anda.",
    noOrders: "Tiada pesanan pembelian pembekal kelihatan dalam skop semasa anda.",
    regenerate: "Jana semula", correct: "Cipta versi dibetulkan", reason: "Sebab",
    ready: "Sedia untuk semakan jualan", approve: "Lulus untuk penghantaran", dispatch: "Hantar pautan selamat",
    resend: "Hantar semula pautan selamat", amend: "Cipta pindaan", cancel: "Batalkan pesanan",
    acknowledge: "Akui pesanan pembelian", warnings: "Amaran",
    noContact: "Tiada hubungan pembekal aktif, disahkan dan tidak disekat tersedia.",
    history: "Setiap penggantian mengekalkan versi dan checksum terdahulu.",
    failure: "Kegagalan baris gilir", pages: "halaman", bytes: "bait",
    notices: {
      queued: "Versi dokumen kekal baharu telah dimasukkan dalam baris gilir.",
      "po-updated": "Status pesanan pembelian pembekal telah dikemas kini.",
    } as Record<string, string>,
  },
} as const;

export function generatedDocumentMessages(locale: SupportedLocale | undefined) {
  return messages[locale ?? "en"] ?? messages.en;
}

export function localizedGeneratedDocumentJobStatus(
  status: string,
  locale: SupportedLocale | undefined,
) {
  const copy = generatedDocumentMessages(locale).jobStatuses as Record<string, string>;
  return copy[status] ?? status;
}

export function formatGeneratedDocumentDate(value: string, locale: SupportedLocale, timezone?: string) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : locale === "ms" ? "ms-MY" : "en-MY", {
    dateStyle: "medium", timeStyle: "short", timeZone: timezone || "UTC",
  }).format(new Date(value));
}

export function formatGeneratedDocumentNumber(value: number, locale: SupportedLocale) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : locale === "ms" ? "ms-MY" : "en-MY").format(value);
}

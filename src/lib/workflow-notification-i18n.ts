import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type SupportedLocale,
} from "./i18n";

type MatchExceptionCode =
  | "MISSING_RECEIPT"
  | "QUANTITY_VARIANCE"
  | "PRICE_VARIANCE"
  | "DUPLICATE_INVOICE";

export type WorkflowNotificationMessage =
  | { key: "invitation_accepted"; accountName: string }
  | { key: "company_lead_created"; companyName: string }
  | { key: "company_assigned"; companyName: string }
  | { key: "company_reassigned"; companyName: string }
  | { key: "company_information_requested"; companyName: string }
  | { key: "company_onboarding_updated"; companyName: string }
  | { key: "company_onboarding_ready"; companyName: string }
  | { key: "company_onboarding_verified"; companyName: string }
  | { key: "company_administrator_activated"; companyName: string }
  | { key: "company_activated"; companyName: string }
  | { key: "company_suspended"; companyName: string }
  | { key: "request_needs_approval"; actorName: string }
  | { key: "request_approved" }
  | { key: "request_rejected" }
  | { key: "request_completed" }
  | { key: "request_status_updated"; status: string }
  | { key: "quotation_requested" }
  | { key: "supplier_rfq_issued"; reference: string }
  | { key: "quotation_received" }
  | { key: "supplier_selected" }
  | { key: "supplier_order_selected" }
  | { key: "supplier_response_recorded" }
  | { key: "delivery_scheduled" }
  | { key: "driver_assigned"; jobCode: string }
  | { key: "delivery_status_updated"; status: string }
  | { key: "driver_delivery_completed" }
  | { key: "receipt_required"; jobCode: string }
  | { key: "driver_delivery_issue"; jobCode: string }
  | { key: "driver_delivery_status"; jobCode: string; status: string }
  | { key: "receipt_confirmed"; jobCode: string }
  | { key: "receiving_discrepancy"; jobCode: string }
  | { key: "invoice_issued" }
  | { key: "payment_status_changed" }
  | { key: "three_way_match_completed" }
  | { key: "three_way_match_exception"; exceptionCodes: readonly string[] };

export interface RenderedWorkflowNotification {
  title: string;
  body: string;
}

const REQUEST_STATUS: Record<SupportedLocale, Record<string, string>> = {
  en: {
    "Waiting for Quotation": "waiting for quotation",
    "Waiting for Approval": "waiting for approval",
    Approved: "approved",
    "Supplier Assigned": "supplier assigned",
    Ordered: "ordered",
    "Preparing for Delivery": "preparing for delivery",
    "Out for Delivery": "out for delivery",
    Delivered: "delivered",
    "Invoice Issued": "invoice issued",
    Completed: "completed",
    "On Hold": "on hold",
    Cancelled: "cancelled",
    Placed: "placed",
    Confirmed: "confirmed",
    Preparing: "preparing",
    Shipped: "shipped",
    Delayed: "delayed",
    Failed: "failed",
    ACCEPTED: "accepted",
    STARTED: "started",
    ARRIVED: "arrived",
    ATTEMPTED: "attempted",
    PARTIALLY_DELIVERED: "partially delivered",
    DELIVERED: "delivered",
    FAILED: "failed",
    REJECTED: "rejected",
    NOTE_ADDED: "note added",
  },
  ar: {
    "Waiting for Quotation": "بانتظار عرض السعر",
    "Waiting for Approval": "بانتظار الاعتماد",
    Approved: "معتمد",
    "Supplier Assigned": "تم تعيين المورد",
    Ordered: "تم الطلب",
    "Preparing for Delivery": "قيد التجهيز للتسليم",
    "Out for Delivery": "خرج للتسليم",
    Delivered: "تم التسليم",
    "Invoice Issued": "صدرت الفاتورة",
    Completed: "مكتمل",
    "On Hold": "معلّق",
    Cancelled: "ملغى",
    Placed: "تم الإنشاء",
    Confirmed: "مؤكد",
    Preparing: "قيد التجهيز",
    Shipped: "تم الشحن",
    Delayed: "متأخر",
    Failed: "فشل",
    ACCEPTED: "تم قبول المهمة",
    STARTED: "بدأت الرحلة",
    ARRIVED: "وصل السائق",
    ATTEMPTED: "تمت محاولة التسليم",
    PARTIALLY_DELIVERED: "تم التسليم جزئيًا",
    DELIVERED: "تم التسليم",
    FAILED: "فشل التسليم",
    REJECTED: "تم رفض المهمة",
    NOTE_ADDED: "أضيفت ملاحظة",
  },
  ms: {
    "Waiting for Quotation": "menunggu sebut harga",
    "Waiting for Approval": "menunggu kelulusan",
    Approved: "diluluskan",
    "Supplier Assigned": "pembekal ditetapkan",
    Ordered: "dipesan",
    "Preparing for Delivery": "sedang disediakan untuk penghantaran",
    "Out for Delivery": "dalam penghantaran",
    Delivered: "dihantar",
    "Invoice Issued": "invois dikeluarkan",
    Completed: "selesai",
    "On Hold": "ditangguhkan",
    Cancelled: "dibatalkan",
    Placed: "dibuat",
    Confirmed: "disahkan",
    Preparing: "sedang disediakan",
    Shipped: "dihantar keluar",
    Delayed: "lewat",
    Failed: "gagal",
    ACCEPTED: "tugasan diterima",
    STARTED: "perjalanan dimulakan",
    ARRIVED: "pemandu tiba",
    ATTEMPTED: "penghantaran dicuba",
    PARTIALLY_DELIVERED: "dihantar sebahagian",
    DELIVERED: "dihantar",
    FAILED: "penghantaran gagal",
    REJECTED: "tugasan ditolak",
    NOTE_ADDED: "nota ditambah",
  },
};

const MATCH_EXCEPTION: Record<SupportedLocale, Record<MatchExceptionCode, string>> = {
  en: {
    MISSING_RECEIPT: "Customer receiving confirmation is still missing.",
    QUANTITY_VARIANCE: "The invoiced quantity does not match the independently accepted quantity.",
    PRICE_VARIANCE: "The invoice unit price does not match the company-approved unit price.",
    DUPLICATE_INVOICE: "This invoice and request line were evaluated previously.",
  },
  ar: {
    MISSING_RECEIPT: "لا يزال تأكيد استلام العميل مفقودًا.",
    QUANTITY_VARIANCE: "الكمية في الفاتورة لا تطابق الكمية المقبولة بصورة مستقلة.",
    PRICE_VARIANCE: "سعر الوحدة في الفاتورة لا يطابق السعر الذي اعتمدته الشركة.",
    DUPLICATE_INVOICE: "سبق تقييم هذه الفاتورة وبند الطلب.",
  },
  ms: {
    MISSING_RECEIPT: "Pengesahan penerimaan pelanggan masih belum direkodkan.",
    QUANTITY_VARIANCE: "Kuantiti invois tidak sepadan dengan kuantiti yang diterima secara bebas.",
    PRICE_VARIANCE: "Harga unit invois tidak sepadan dengan harga yang diluluskan syarikat.",
    DUPLICATE_INVOICE: "Invois dan baris permintaan ini pernah dinilai.",
  },
};

function boundedParameter(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function statusLabel(locale: SupportedLocale, status: string) {
  const safe = boundedParameter(status, "Notification status");
  return REQUEST_STATUS[locale][safe] ?? safe;
}

function exceptionText(locale: SupportedLocale, codes: readonly string[]) {
  const known = [...new Set(codes)]
    .filter((code): code is MatchExceptionCode => code in MATCH_EXCEPTION[locale]);
  if (!known.length) {
    return locale === "ar"
      ? "تحتاج المطابقة إلى مراجعة فريق المالية. افتح السجل للاطلاع على التفاصيل الآمنة."
      : locale === "ms"
        ? "Padanan memerlukan semakan kewangan. Buka rekod untuk butiran yang selamat."
        : "The match needs finance review. Open the record for safe details.";
  }
  return known.map((code) => MATCH_EXCEPTION[locale][code]).join(" ");
}

export function normalizeNotificationLocale(value: string | undefined | null): SupportedLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export function renderWorkflowNotification(
  message: WorkflowNotificationMessage,
  localeValue: string | undefined | null,
): RenderedWorkflowNotification {
  const locale = normalizeNotificationLocale(localeValue);
  switch (message.key) {
    case "invitation_accepted": {
      const accountName = boundedParameter(message.accountName, "Invited account name");
      if (locale === "ar") return { title: "تم تفعيل الحساب المدعو", body: `أكمل ${accountName} إعداد الحساب ويمكنه الآن تسجيل الدخول.` };
      if (locale === "ms") return { title: "Akaun jemputan diaktifkan", body: `${accountName} telah melengkapkan persediaan akaun dan kini boleh mendaftar masuk.` };
      return { title: "Invited account activated", body: `${accountName} completed account setup and can now sign in.` };
    }
    case "company_lead_created": {
      const companyName = boundedParameter(message.companyName, "Company name");
      if (locale === "ar") return { title: "أُنشئ عميل محتمل جديد", body: `أُضيف سجل ${companyName} إلى مسار مراجعة الشركات.` };
      if (locale === "ms") return { title: "Prospek syarikat baharu dicipta", body: `${companyName} ditambah kepada aliran semakan syarikat.` };
      return { title: "New company lead created", body: `${companyName} was added to the company review workflow.` };
    }
    case "company_assigned": {
      const companyName = boundedParameter(message.companyName, "Company name");
      if (locale === "ar") return { title: "أُسندت شركة", body: `أُسند سجل ${companyName} إلى مدير حساب عميل.` };
      if (locale === "ms") return { title: "Syarikat ditugaskan", body: `${companyName} ditugaskan kepada Pengurus Akaun Pelanggan.` };
      return { title: "Company assigned", body: `${companyName} was assigned to a Client Account Manager.` };
    }
    case "company_reassigned": {
      const companyName = boundedParameter(message.companyName, "Company name");
      if (locale === "ar") return { title: "أُعيد إسناد شركة", body: `نُقلت مسؤولية ${companyName} ومهام التهيئة المفتوحة إلى المدير الجديد.` };
      if (locale === "ms") return { title: "Syarikat ditugaskan semula", body: `${companyName} dan tugasan penerimaan masuk terbukanya dipindahkan kepada pengurus baharu.` };
      return { title: "Company reassigned", body: `${companyName} and its open onboarding work moved to the new manager.` };
    }
    case "company_information_requested": {
      const companyName = boundedParameter(message.companyName, "Company name");
      if (locale === "ar") return { title: "معلومات الشركة مطلوبة", body: `يحتاج سجل ${companyName} إلى معلومات إضافية قبل متابعة التهيئة.` };
      if (locale === "ms") return { title: "Maklumat syarikat diperlukan", body: `${companyName} memerlukan maklumat tambahan sebelum penerimaan masuk diteruskan.` };
      return { title: "Company information requested", body: `${companyName} needs more information before onboarding can continue.` };
    }
    case "company_onboarding_updated": {
      const companyName = boundedParameter(message.companyName, "Company name");
      if (locale === "ar") return { title: "تم تحديث تهيئة الشركة", body: `تم حفظ معلومات أو أدلة تهيئة ${companyName}.` };
      if (locale === "ms") return { title: "Penerimaan masuk syarikat dikemas kini", body: `Maklumat atau bukti penerimaan masuk ${companyName} telah disimpan.` };
      return { title: "Company onboarding updated", body: `${companyName}'s onboarding information or evidence was saved.` };
    }
    case "company_onboarding_ready": {
      const companyName = boundedParameter(message.companyName, "Company name");
      if (locale === "ar") return { title: "تهيئة الشركة جاهزة للمراجعة", body: `اكتملت الفحوص الإلزامية لـ ${companyName} وهي جاهزة للتحقق.` };
      if (locale === "ms") return { title: "Penerimaan masuk syarikat sedia disemak", body: `Semakan wajib ${companyName} selesai dan sedia untuk pengesahan.` };
      return { title: "Company onboarding ready for review", body: `${companyName}'s mandatory checks are complete and ready for verification.` };
    }
    case "company_onboarding_verified": {
      const companyName = boundedParameter(message.companyName, "Company name");
      if (locale === "ar") return { title: "تم التحقق من تهيئة الشركة", body: `تم التحقق من تهيئة ${companyName}. يبقى التفعيل خطوة منفصلة.` };
      if (locale === "ms") return { title: "Penerimaan masuk syarikat disahkan", body: `Penerimaan masuk ${companyName} disahkan. Pengaktifan kekal langkah berasingan.` };
      return { title: "Company onboarding verified", body: `${companyName}'s onboarding was verified. Activation remains a separate step.` };
    }
    case "company_administrator_activated": {
      const companyName = boundedParameter(message.companyName, "Company name");
      if (locale === "ar") return { title: "تم تفعيل مدير الشركة", body: `أكمل مدير ${companyName} إعداد الحساب الآمن.` };
      if (locale === "ms") return { title: "Pentadbir Syarikat diaktifkan", body: `Pentadbir ${companyName} melengkapkan persediaan akaun selamat.` };
      return { title: "Company Administrator activated", body: `${companyName}'s administrator completed secure account setup.` };
    }
    case "company_activated": {
      const companyName = boundedParameter(message.companyName, "Company name");
      if (locale === "ar") return { title: "تم تفعيل الشركة", body: `اكتملت متطلبات تهيئة ${companyName} ويمكنها الآن بدء معاملات جديدة.` };
      if (locale === "ms") return { title: "Syarikat diaktifkan", body: `${companyName} melengkapkan keperluan penerimaan masuk dan kini boleh memulakan transaksi baharu.` };
      return { title: "Company activated", body: `${companyName} completed onboarding and can now begin new transactions.` };
    }
    case "company_suspended": {
      const companyName = boundedParameter(message.companyName, "Company name");
      if (locale === "ar") return { title: "تم تعليق الشركة", body: `عُلقت المعاملات الجديدة لـ ${companyName} مع الحفاظ على السجلات والعمل المفتوح.` };
      if (locale === "ms") return { title: "Syarikat digantung", body: `Transaksi baharu ${companyName} disekat sementara rekod dan kerja terbuka dikekalkan.` };
      return { title: "Company suspended", body: `${companyName} cannot start new transactions; records and open work were preserved.` };
    }
    case "request_needs_approval": {
      const actorName = boundedParameter(message.actorName, "Notification actor name");
      if (locale === "ar") return { title: "طلب شراء يحتاج إلى اعتماد", body: `أرسل ${actorName} طلب شراء للمراجعة.` };
      if (locale === "ms") return { title: "Permintaan pembelian memerlukan kelulusan", body: `${actorName} menghantar permintaan pembelian untuk semakan.` };
      return { title: "Purchase request needs approval", body: `${actorName} submitted a purchase request for review.` };
    }
    case "request_approved":
      if (locale === "ar") return { title: "تم اعتماد طلب الشراء", body: "اعتمدت الشركة طلب الشراء، ويمكن لأكسورا بدء التوريد." };
      if (locale === "ms") return { title: "Permintaan pembelian diluluskan", body: "Syarikat meluluskan permintaan pembelian. Axora boleh memulakan perolehan sumber." };
      return { title: "Purchase request approved", body: "The company approved the purchase request. Axora can begin sourcing." };
    case "request_rejected":
      if (locale === "ar") return { title: "تم رفض طلب الشراء", body: "رفضت الشركة طلب الشراء. افتحه لمراجعة السبب المسجل." };
      if (locale === "ms") return { title: "Permintaan pembelian ditolak", body: "Syarikat menolak permintaan pembelian. Buka rekod untuk menyemak sebabnya." };
      return { title: "Purchase request rejected", body: "The company rejected the purchase request. Open it to review the recorded reason." };
    case "request_completed":
      if (locale === "ar") return { title: "اكتمل طلب الشراء", body: "انتقل طلب الشراء إلى حالة مكتمل." };
      if (locale === "ms") return { title: "Permintaan pembelian selesai", body: "Permintaan pembelian beralih kepada status selesai." };
      return { title: "Purchase request completed", body: "Your purchase request moved to completed." };
    case "request_status_updated": {
      const status = statusLabel(locale, message.status);
      if (locale === "ar") return { title: "تم تحديث طلب الشراء", body: `انتقل طلب الشراء إلى حالة: ${status}.` };
      if (locale === "ms") return { title: "Permintaan pembelian dikemas kini", body: `Permintaan pembelian beralih kepada status ${status}.` };
      return { title: "Purchase request updated", body: `Your purchase request moved to ${status}.` };
    }
    case "quotation_received":
      if (locale === "ar") return { title: "تم استلام عرض سعر", body: "استلمت أكسورا عرض سعر لطلب شراء معتمد." };
      if (locale === "ms") return { title: "Sebut harga diterima", body: "Axora menerima sebut harga untuk permintaan pembelian yang diluluskan." };
      return { title: "Quotation received", body: "Axora received a quotation for an approved purchase request." };
    case "quotation_requested":
      if (locale === "ar") return { title: "بدأ طلب عروض الأسعار", body: "أرسلت أكسورا طلب عرض سعر لبند معتمد دون كشف بيانات المورد الخاصة." };
      if (locale === "ms") return { title: "Permintaan sebut harga dimulakan", body: "Axora menghantar RFQ bagi baris yang diluluskan tanpa mendedahkan data peribadi pembekal." };
      return { title: "Quotation requested", body: "Axora issued an RFQ for an approved line without exposing private supplier data." };
    case "supplier_rfq_issued": {
      const reference = boundedParameter(message.reference, "RFQ reference");
      if (locale === "ar") return { title: "طلب عرض سعر جديد", body: `طلب عرض السعر ${reference} جاهز في مساحة عمل المورد.` };
      if (locale === "ms") return { title: "RFQ baharu", body: `RFQ ${reference} sedia dalam ruang kerja pembekal anda.` };
      return { title: "New quotation request", body: `RFQ ${reference} is ready in your supplier workspace.` };
    }
    case "supplier_selected":
      if (locale === "ar") return { title: "تم تأكيد خيار التوريد", body: "اختارت أكسورا خيار توريد معتمدًا لطلبك." };
      if (locale === "ms") return { title: "Pilihan pembekal disahkan", body: "Axora memilih pilihan perolehan yang diluluskan untuk permintaan anda." };
      return { title: "Supplier option confirmed", body: "Axora selected an approved sourcing option for your request." };
    case "supplier_order_selected":
      if (locale === "ar") return { title: "تم اختيار عرضكم", body: "اختارت أكسورا عرضكم. افتح مساحة عمل المورد لتأكيد الطلب ورفع المستندات المساندة." };
      if (locale === "ms") return { title: "Sebut harga anda dipilih", body: "Axora memilih sebut harga anda. Buka ruang kerja pembekal untuk mengakui pesanan dan memuat naik dokumen sokongan." };
      return { title: "Your quotation was selected", body: "Axora selected your quotation. Open the supplier workspace to acknowledge the order and upload supporting documents." };
    case "supplier_response_recorded":
      if (locale === "ar") return { title: "سجل المورد ردًا", body: "سجل المورد تأكيدًا أو استيضاحًا جديدًا في طلب عرض السعر." };
      if (locale === "ms") return { title: "Respons pembekal direkodkan", body: "Pembekal merekodkan pengakuan atau permintaan penjelasan baharu pada RFQ." };
      return { title: "Supplier response recorded", body: "The supplier recorded a new acknowledgement or clarification on the RFQ." };
    case "delivery_scheduled":
      if (locale === "ar") return { title: "تمت جدولة التسليم", body: "أنشأت أكسورا مهمة تسليم لطلب الشراء هذا." };
      if (locale === "ms") return { title: "Penghantaran dijadualkan", body: "Axora mencipta tugasan penghantaran untuk permintaan pembelian ini." };
      return { title: "Delivery scheduled", body: "Axora created a delivery job for this purchase request." };
    case "driver_assigned": {
      const jobCode = boundedParameter(message.jobCode, "Delivery job code");
      if (locale === "ar") return { title: "مهمة تسليم جديدة", body: `التسليم ${jobCode} جاهز في مساحة عمل السائق.` };
      if (locale === "ms") return { title: "Tugasan penghantaran baharu", body: `Penghantaran ${jobCode} sedia dalam ruang kerja pemandu anda.` };
      return { title: "New delivery assignment", body: `Delivery ${jobCode} is ready in your driver workspace.` };
    }
    case "delivery_status_updated": {
      const status = statusLabel(locale, message.status);
      if (locale === "ar") return { title: "تم تحديث حالة التسليم", body: `تغيرت حالة التسليم إلى: ${status}.` };
      if (locale === "ms") return { title: "Status penghantaran dikemas kini", body: `Status penghantaran berubah kepada ${status}.` };
      return { title: "Delivery status updated", body: `The delivery status changed to ${status}.` };
    }
    case "driver_delivery_completed":
      if (locale === "ar") return { title: "أبلغ السائق عن اكتمال التسليم", body: "سجل السائق التسليم، ولا يزال تأكيد الكميات من العميل مطلوبًا." };
      if (locale === "ms") return { title: "Pemandu melaporkan penghantaran selesai", body: "Pemandu merekodkan penghantaran. Pengesahan kuantiti pelanggan masih diperlukan." };
      return { title: "Delivery reported complete", body: "The driver recorded delivery. Customer quantity confirmation is still required." };
    case "receipt_required": {
      const jobCode = boundedParameter(message.jobCode, "Delivery job code");
      if (locale === "ar") return { title: "تأكيد الاستلام مطلوب", body: `سجل السائق نتيجة التسليم ${jobCode}. يجب على مستلم عميل مخوّل فحص الكميات وتأكيدها بصورة مستقلة.` };
      if (locale === "ms") return { title: "Pengesahan penerimaan diperlukan", body: `Pemandu merekodkan hasil penghantaran ${jobCode}. Penerima pelanggan yang diberi kuasa mesti memeriksa dan mengesahkan kuantiti secara berasingan.` };
      return { title: "Receiving confirmation required", body: `The driver recorded delivery outcome ${jobCode}. An authorized customer receiver must inspect and confirm quantities independently.` };
    }
    case "driver_delivery_issue": {
      const jobCode = boundedParameter(message.jobCode, "Delivery job code");
      if (locale === "ar") return { title: "أبلغ السائق عن مشكلة تسليم", body: `أبلغ السائق عن مشكلة في التسليم ${jobCode}.` };
      if (locale === "ms") return { title: "Pemandu melaporkan isu penghantaran", body: `Pemandu melaporkan isu bagi penghantaran ${jobCode}.` };
      return { title: "Delivery issue reported", body: `The driver reported an issue for delivery ${jobCode}.` };
    }
    case "driver_delivery_status": {
      const jobCode = boundedParameter(message.jobCode, "Delivery job code");
      const status = statusLabel(locale, message.status);
      if (locale === "ar") return { title: "تم تحديث حالة التسليم", body: `انتقل التسليم ${jobCode} إلى حالة: ${status}.` };
      if (locale === "ms") return { title: "Status penghantaran dikemas kini", body: `Penghantaran ${jobCode} beralih kepada status ${status}.` };
      return { title: "Delivery status updated", body: `Delivery ${jobCode} moved to ${status}.` };
    }
    case "receipt_confirmed": {
      const jobCode = boundedParameter(message.jobCode, "Delivery job code");
      if (locale === "ar") return { title: "أكد العميل الاستلام", body: `أكد مستلم مخوّل من العميل استلام التسليم ${jobCode}.` };
      if (locale === "ms") return { title: "Penerimaan pelanggan disahkan", body: `Penerima pelanggan yang diberi kuasa mengesahkan penghantaran ${jobCode}.` };
      return { title: "Customer receipt confirmed", body: `An authorized customer receiver confirmed delivery ${jobCode}.` };
    }
    case "receiving_discrepancy": {
      const jobCode = boundedParameter(message.jobCode, "Delivery job code");
      if (locale === "ar") return { title: "تم تسجيل فرق عند الاستلام", body: `سجل مستلم العميل فرقًا في الكمية أو الفحص للتسليم ${jobCode}.` };
      if (locale === "ms") return { title: "Percanggahan penerimaan direkodkan", body: `Penerima pelanggan merekodkan percanggahan kuantiti atau pemeriksaan bagi penghantaran ${jobCode}.` };
      return { title: "Receiving discrepancy raised", body: `A customer receiver recorded a quantity or inspection discrepancy for delivery ${jobCode}.` };
    }
    case "invoice_issued":
      if (locale === "ar") return { title: "صدرت الفاتورة", body: "أصبحت فاتورة العميل متاحة لطلب الشراء هذا." };
      if (locale === "ms") return { title: "Invois dikeluarkan", body: "Invois pelanggan tersedia untuk permintaan pembelian ini." };
      return { title: "Invoice issued", body: "A customer invoice is available for this purchase request." };
    case "payment_status_changed":
      if (locale === "ar") return { title: "تم تحديث حالة الدفع", body: "تم تسجيل دفعة عند الاستلام على فاتورة العميل." };
      if (locale === "ms") return { title: "Status bayaran dikemas kini", body: "Bayaran tunai semasa penghantaran direkodkan pada invois pelanggan anda." };
      return { title: "Payment status updated", body: "A COD payment was recorded against your customer invoice." };
    case "three_way_match_completed":
      if (locale === "ar") return { title: "اكتملت المطابقة الثلاثية", body: "يتطابق الطلب المعتمد والاستلام وفاتورة العميل." };
      if (locale === "ms") return { title: "Padanan tiga hala selesai", body: "Pesanan yang diluluskan, penerimaan dan invois pelanggan sepadan." };
      return { title: "Three-way match completed", body: "Approved order, receipt, and customer invoice match." };
    case "three_way_match_exception":
      if (locale === "ar") return { title: "المطابقة الثلاثية تحتاج إلى مراجعة", body: exceptionText(locale, message.exceptionCodes) };
      if (locale === "ms") return { title: "Padanan tiga hala memerlukan semakan", body: exceptionText(locale, message.exceptionCodes) };
      return { title: "Three-way match needs review", body: exceptionText(locale, message.exceptionCodes) };
  }
}

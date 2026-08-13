import type { DeliveryClientEventType, DeliveryIssueCode } from "./delivery-portal";
import type { SupportedLocale } from "./i18n";

const INTL_LOCALES: Record<SupportedLocale, string> = {
  en: "en-MY",
  ar: "ar-MY",
  ms: "ms-MY",
};

export interface RolePortalMessages {
  statuses: Record<string, string>;
  supplier: {
    eyebrow: string;
    description: string;
    notices: Record<string, string>;
    summaryLabel: string;
    assignedRfqs: string;
    actionable: string;
    submittedQuotations: string;
    emptyTitle: string;
    emptyBody: string;
    quantity: string;
    respondBy: string;
    latestResponse: string;
    quotationVersion: (version: number, status: string) => string;
    notSubmitted: string;
    quotedUnitPrice: string;
    specification: string;
    documents: string;
    documentVersion: (kind: string, version: number) => string;
    acknowledgeSummary: string;
    response: string;
    acknowledge: string;
    requestClarification: string;
    decline: string;
    note: string;
    buyerContextPlaceholder: string;
    recordResponse: string;
    submitRevised: string;
    submitQuotation: string;
    quotationReference: string;
    unitPrice: string;
    deliveryCharge: string;
    leadTimeDays: string;
    validUntil: string;
    commercialNote: string;
    submitVersioned: string;
    uploadSummary: string;
    pdfOrImage: string;
    uploadHint: string;
    uploadDocument: string;
    noDeadline: string;
    profileTitle: string;
    profileIntro: string;
    contact: string;
    category: string;
    coverage: string;
    address: string;
    paymentTerms: string;
    standardLeadTime: string;
    mainProducts: string;
    selectedOrder: string;
    selectedOrderHelp: string;
    selectedOrderResponse: string;
    availability: string;
    availabilityLabels: Record<"AVAILABLE" | "PARTIAL" | "MADE_TO_ORDER" | "OUT_OF_STOCK", string>;
    responseHistory: string;
    noResponseNote: string;
    invoiceTitle: string;
    invoiceIntro: string;
    invoiceNumber: string;
    order: string;
    amount: string;
    paymentStatus: string;
    noInvoices: string;
    uploadInvoiceSummary: string;
    uploadInvoiceHint: string;
  };
  driver: {
    eyebrow: string;
    title: string;
    description: string;
    eventLabels: Record<DeliveryClientEventType, string>;
    notScheduled: string;
    serverNotConfirmed: string;
    allSynced: string;
    syncPaused: string;
    offlineStorageUnavailable: string;
    queueRecoveryRequired: string;
    queueRecoveryResolved: string;
    queueReloaded: string;
    queueRecoveryExported: string;
    queueRecoveryDiscarded: string;
    queueRecoveryTitle: string;
    queueRecoveryBody: string;
    queueRecoveryDetail: (validCount: number, totalCount?: number) => string;
    queueRecoveryPrivacy: string;
    retryQueueValidation: string;
    exportQueueRecovery: string;
    discardQueueRecovery: string;
    confirmDiscardTitle: string;
    confirmDiscardBody: string;
    cancelDiscard: string;
    confirmDiscard: string;
    alreadyLatest: (status: string) => string;
    statusSavedSyncing: string;
    statusSavedOffline: string;
    updateNotSaved: string;
    uploadingEvidence: string;
    evidenceUploadFailed: string;
    evidenceUploaded: string;
    evidenceRetry: string;
    evidencePausedRetry: string;
    offline: string;
    syncing: string;
    online: string;
    updatesWaiting: (count: number) => string;
    syncNow: string;
    emptyTitle: string;
    emptyBody: string;
    windowStarts: string;
    windowEnds: string;
    packages: string;
    instructions: string;
    navigate: string;
    updateJob: (jobCode: string) => string;
    accept: string;
    reject: string;
    enRoute: string;
    arrived: string;
    attempted: string;
    partiallyDelivered: string;
    delivered: string;
    failed: string;
    deliveryOutcome: string;
    reportedReceiverName: string;
    deliveredQuantity: string;
    damagedQuantity: string;
    missingQuantity: string;
    evidenceOnly: string;
    issueReport: string;
    issueReason: string;
    issueLabels: Record<DeliveryIssueCode, string>;
    issueNote: string;
    issueNotePlaceholder: string;
    recordAttempt: string;
    reportIssue: string;
    queuedUpdates: (count: number) => string;
    lastConfirmed: (date: string) => string;
    noStatus: string;
    addNote: string;
    operationalNote: string;
    saveNoteOffline: string;
    uploadEvidence: string;
    photoOrDeliveryNote: string;
    syncBeforeEvidence: string;
    evidenceHint: string;
    uploadEvidenceButton: string;
  };
  receiving: {
    eyebrow: string;
    title: string;
    description: string;
    receiptConfirmedNotice: string;
    summaryLabel: string;
    deliveredJobs: string;
    awaitingConfirmation: string;
    confirmed: string;
    emptyTitle: string;
    emptyBody: string;
    awaitingDriverEvent: string;
    driverRecorded: string;
    driverReportedReceiver: string;
    driverEvidenceOnly: string;
    driverReportedQuantity: string;
    missing: string;
    confirmingAs: (name: string) => string;
    receiptComplete: string;
    receiptId: string;
    readOnlyTitle: string;
    readOnlyBody: string;
    inspectLines: (count: number) => string;
    quantityRule: string;
    planned: string;
    delivered: string;
    accepted: string;
    damaged: string;
    inspectionClassification: string;
    noManualException: string;
    wrongItem: string;
    qualityIssue: string;
    otherException: string;
    lineNote: string;
    discrepancyPlaceholder: string;
    receiptNotes: string;
    receiptNotesPlaceholder: string;
    confirmationExplanation: string;
    confirmReceipt: string;
  };
}

const english: RolePortalMessages = {
  statuses: {
    CREATED: "Created", ISSUED: "Issued", VIEWED: "Viewed", ACKNOWLEDGED: "Acknowledged",
    RESPONDED: "Responded", DECLINED: "Declined", WITHDRAWN: "Withdrawn", EXPIRED: "Expired",
    CLOSED: "Closed", SUBMITTED: "Submitted", REVISED: "Revised", ASSIGNED: "Assigned",
    ACCEPTED: "Accepted", REJECTED: "Rejected", REASSIGNED: "Reassigned", CANCELLED: "Cancelled",
    COMPLETED: "Completed", EN_ROUTE: "En route", ARRIVED: "Arrived", DELIVERED: "Delivered",
    DELIVERY_ATTEMPTED: "Delivery attempted", PARTIALLY_DELIVERED: "Partially delivered",
    FAILED: "Failed", ISSUE_REPORTED: "Issue reported", NOTE_ADDED: "Note added", CONFIRMED: "Confirmed",
    AWAITING_CONFIRMATION: "Awaiting confirmation", RFQ: "RFQ", QUOTATION: "Quotation",
    ACKNOWLEDGEMENT: "Acknowledgement", CLARIFICATION: "Clarification", SUPPORTING: "Supporting",
  },
  supplier: {
    eyebrow: "Supplier workspace",
    description: "Review only the quotation requests assigned to your supplier, acknowledge each request, and submit versioned commercial responses.",
    notices: {
      "acknowledgement-recorded": "Your RFQ response was recorded.",
      "quotation-submitted": "Your quotation was submitted and versioned.",
      "document-uploaded": "Your quotation document was uploaded securely.",
      "invoice-document-uploaded": "Your invoice or supporting document was uploaded securely for Axora finance review.",
    },
    summaryLabel: "Supplier queue summary", assignedRfqs: "Assigned RFQs", actionable: "Actionable",
    submittedQuotations: "Submitted quotations", emptyTitle: "No quotation requests",
    emptyBody: "New RFQs assigned to your supplier will appear here.", quantity: "Quantity",
    respondBy: "Respond by", latestResponse: "Latest response",
    quotationVersion: (version, status) => `Version ${version} · ${status}`,
    notSubmitted: "Not submitted", quotedUnitPrice: "Quoted unit price", specification: "Specification",
    documents: "Documents", documentVersion: (kind, version) => `${kind.toLocaleLowerCase("en-MY")} · v${version}`,
    acknowledgeSummary: "Acknowledge or query RFQ", response: "Response", acknowledge: "Acknowledge",
    requestClarification: "Request clarification", decline: "Decline", note: "Note",
    buyerContextPlaceholder: "Optional context for the buyer", recordResponse: "Record response",
    submitRevised: "Submit revised quotation", submitQuotation: "Submit quotation",
    quotationReference: "Quotation reference", unitPrice: "Unit price (MYR)",
    deliveryCharge: "Delivery charge (MYR)",
    leadTimeDays: "Lead time (days)", validUntil: "Valid until", commercialNote: "Commercial note",
    submitVersioned: "Submit versioned quotation", uploadSummary: "Upload quotation document",
    pdfOrImage: "PDF or image", uploadHint: "Maximum 5 MB. Files are validated and available only to your supplier account.",
    uploadDocument: "Upload document", noDeadline: "No deadline",
    profileTitle: "Supplier profile", profileIntro: "This is the private Axora supplier record for your organization. Contact Axora operations if a detail is outdated.",
    contact: "Primary contact", category: "Category", coverage: "Coverage", address: "Address",
    paymentTerms: "Payment terms", standardLeadTime: "Standard lead time", mainProducts: "Main products",
    selectedOrder: "Selected order", selectedOrderHelp: "Axora selected your quotation. Confirm the order below; customer buying and private Axora margin data remain hidden.",
    selectedOrderResponse: "Acknowledge selected order", availability: "Availability",
    availabilityLabels: { AVAILABLE: "Available", PARTIAL: "Partially available", MADE_TO_ORDER: "Made to order", OUT_OF_STOCK: "Out of stock" },
    responseHistory: "Response and clarification history", noResponseNote: "No note provided",
    invoiceTitle: "Supplier invoices and payment status", invoiceIntro: "Only invoices registered by Axora finance for your supplier organization appear here.",
    invoiceNumber: "Invoice", order: "Order", amount: "Amount", paymentStatus: "Payment status", noInvoices: "No registered supplier invoices yet.",
    uploadInvoiceSummary: "Upload invoice or supporting document", uploadInvoiceHint: "Available only for selected work. Axora finance must still validate and register the invoice before a payment status appears.",
  },
  driver: {
    eyebrow: "Driver workspace", title: "Assigned deliveries",
    description: "Record progress when you have a signal or when you do not. Status events stay on this device until the server confirms them.",
    eventLabels: { ACCEPTED: "Accepted", REJECTED: "Rejected", EN_ROUTE: "En route", ARRIVED: "Arrived", DELIVERY_ATTEMPTED: "Delivery attempted", PARTIALLY_DELIVERED: "Partially delivered", DELIVERED: "Delivered", FAILED: "Failed", ISSUE_REPORTED: "Issue reported", NOTE_ADDED: "Note added" },
    notScheduled: "Not scheduled", serverNotConfirmed: "The server did not confirm this event.",
    allSynced: "All saved status updates are synced.",
    syncPaused: "Sync paused. Your updates remain safely on this device.",
    offlineStorageUnavailable: "Offline storage is unavailable in this browser. Enable site storage before recording delivery updates.",
    queueRecoveryRequired: "Sync is paused because saved delivery updates need recovery. Nothing was changed or deleted.",
    queueRecoveryResolved: "The saved delivery queue is valid again. Sync can continue.",
    queueReloaded: "Saved delivery updates changed in another Axora tab. This view was reloaded safely before sync.",
    queueRecoveryExported: "A private recovery file was downloaded. Keep it secure and share it only with authorized Axora support.",
    queueRecoveryDiscarded: "The damaged local copy was discarded after confirmation. New delivery updates can now be recorded.",
    queueRecoveryTitle: "Saved delivery updates need attention",
    queueRecoveryBody: "Axora could not safely validate the complete saved queue. Automatic sync and new offline updates are paused so the original data is not overwritten.",
    queueRecoveryDetail: (validCount, totalCount) => totalCount === undefined
      ? "The saved data could not be read. No saved item was changed."
      : `${validCount} of ${totalCount} saved item${totalCount === 1 ? "" : "s"} passed validation. No item will sync until the complete queue is safe.`,
    queueRecoveryPrivacy: "Download the recovery file before discarding if support may need it. It can contain private delivery notes, so store and share it securely.",
    retryQueueValidation: "Retry validation",
    exportQueueRecovery: "Download recovery file",
    discardQueueRecovery: "Discard local copy",
    confirmDiscardTitle: "Discard this saved copy?",
    confirmDiscardBody: "This removes the queue from this browser and cannot be undone here. Download the recovery file first if any update may still be needed.",
    cancelDiscard: "Keep saved copy",
    confirmDiscard: "Confirm discard",
    alreadyLatest: (status) => `${status} is already the latest saved status.`,
    statusSavedSyncing: "Status saved. Syncing now…",
    statusSavedOffline: "Status saved on this device. It will sync when you are online.",
    updateNotSaved: "The delivery update could not be saved on this device.",
    uploadingEvidence: "Uploading evidence…", evidenceUploadFailed: "Evidence upload failed.",
    evidenceUploaded: "Evidence uploaded securely.", evidenceRetry: "Choose the same file to retry safely.",
    evidencePausedRetry: "Evidence upload paused. Choose the same file to retry safely.",
    offline: "Offline", syncing: "Syncing", online: "Online",
    updatesWaiting: (count) => `${count} update${count === 1 ? "" : "s"} waiting`, syncNow: "Sync now",
    emptyTitle: "No active assignments", emptyBody: "Your assigned delivery jobs will appear here.",
    windowStarts: "Window starts", windowEnds: "Window ends", packages: "Packages", instructions: "Instructions", navigate: "Open navigation",
    updateJob: (jobCode) => `Update ${jobCode}`, accept: "Accept", reject: "Reject", enRoute: "En route",
    arrived: "Arrived", attempted: "Attempted", partiallyDelivered: "Partially delivered", delivered: "Delivered", failed: "Failed",
    deliveryOutcome: "Record handover outcome", reportedReceiverName: "Name given at handover",
    deliveredQuantity: "Delivered", damagedQuantity: "Damaged", missingQuantity: "Missing",
    evidenceOnly: "This is driver-reported evidence only. The customer receiver confirms acceptance separately.",
    issueReport: "Attempt or delivery issue", issueReason: "Reason",
    issueLabels: { CUSTOMER_UNAVAILABLE: "Customer unavailable", ACCESS_BLOCKED: "Access blocked", ADDRESS_PROBLEM: "Address problem", DAMAGED_ITEMS: "Damaged items", MISSING_ITEMS: "Missing items", VEHICLE_PROBLEM: "Vehicle problem", SAFETY_CONCERN: "Safety concern", OTHER: "Other" },
    issueNote: "What happened?", issueNotePlaceholder: "Add a concise operational description",
    recordAttempt: "Record attempted delivery", reportIssue: "Report issue",
    queuedUpdates: (count) => `${count} update${count === 1 ? "" : "s"} safely queued on this device.`,
    lastConfirmed: (date) => `Last confirmed ${date}.`, noStatus: "No status recorded yet.",
    addNote: "Add Delivery Guy note", operationalNote: "Operational note", saveNoteOffline: "Save note offline",
    uploadEvidence: "Upload driver evidence", photoOrDeliveryNote: "Photo or delivery note",
    syncBeforeEvidence: "Sync the latest status before attaching evidence to it.",
    evidenceHint: "Maximum 5 MB. Evidence supports the driver timeline; the receiver confirms quantities separately.",
    uploadEvidenceButton: "Upload evidence",
  },
  receiving: {
    eyebrow: "Customer receiving", title: "Confirm delivered quantities",
    description: "Inspect every line independently. Driver photos and delivery notes are supporting evidence, not customer acceptance.",
    receiptConfirmedNotice: "Receipt confirmed and recorded independently from driver evidence.",
    summaryLabel: "Receiving summary", deliveredJobs: "Delivered jobs", awaitingConfirmation: "Awaiting confirmation",
    confirmed: "Confirmed", emptyTitle: "No delivered jobs",
    emptyBody: "A job appears here only after its assigned driver records delivery.",
    awaitingDriverEvent: "Awaiting driver delivery event", driverRecorded: "Driver recorded:",
    driverReportedReceiver: "Driver-reported handover name", driverEvidenceOnly: "Supporting driver evidence only — it is not customer acceptance.",
    driverReportedQuantity: "Driver reported", missing: "missing", confirmingAs: (name) => `You are confirming as ${name}.`,
    receiptComplete: "Customer receipt is complete", receiptId: "Receipt ID",
    readOnlyTitle: "Read-only receiving view", readOnlyBody: "A scoped customer receiving user must inspect and confirm every line.",
    inspectLines: (count) => `Inspect all ${count} line${count === 1 ? "" : "s"}`,
    quantityRule: "Accepted + rejected must equal the quantity you observed as delivered.",
    planned: "Planned", delivered: "Delivered", accepted: "Accepted", damaged: "Damaged",
    inspectionClassification: "Inspection classification", noManualException: "No manual exception",
    wrongItem: "Wrong item", qualityIssue: "Quality issue", otherException: "Other exception",
    lineNote: "Line note", discrepancyPlaceholder: "Describe damage, quality, or other differences",
    receiptNotes: "Receipt notes", receiptNotesPlaceholder: "Optional note about the overall delivery",
    confirmationExplanation: "By confirming, you create the customer receipt. This does not alter the driver’s evidence.",
    confirmReceipt: "Confirm customer receipt",
  },
};

const arabic: RolePortalMessages = {
  statuses: {
    CREATED: "تم الإنشاء", ISSUED: "صدر", VIEWED: "تمت المشاهدة", ACKNOWLEDGED: "تم التأكيد",
    RESPONDED: "تم الرد", DECLINED: "مرفوض", WITHDRAWN: "مسحوب", EXPIRED: "منتهي الصلاحية",
    CLOSED: "مغلق", SUBMITTED: "مقدم", REVISED: "منقح", ASSIGNED: "مسند",
    ACCEPTED: "مقبول", REJECTED: "مرفوض", REASSIGNED: "أعيد إسناده", CANCELLED: "ملغي",
    COMPLETED: "مكتمل", EN_ROUTE: "في الطريق", ARRIVED: "وصل", DELIVERED: "تم التسليم",
    DELIVERY_ATTEMPTED: "جرت محاولة التسليم", PARTIALLY_DELIVERED: "تم التسليم جزئيًا",
    FAILED: "تعذر التسليم", ISSUE_REPORTED: "تم الإبلاغ عن مشكلة", NOTE_ADDED: "أضيفت ملاحظة", CONFIRMED: "مؤكد",
    AWAITING_CONFIRMATION: "بانتظار التأكيد", RFQ: "طلب عرض سعر", QUOTATION: "عرض سعر",
    ACKNOWLEDGEMENT: "تأكيد", CLARIFICATION: "استيضاح", SUPPORTING: "مساند",
  },
  supplier: {
    eyebrow: "مساحة عمل المورد",
    description: "راجع فقط طلبات عروض الأسعار المسندة إلى مؤسستك، وأكد استلام كل طلب، ثم قدم عروضك التجارية بإصدارات محفوظة.",
    notices: {
      "acknowledgement-recorded": "تم تسجيل ردك على طلب عرض السعر.",
      "quotation-submitted": "تم تقديم عرض السعر وحفظ إصداره.",
      "document-uploaded": "تم رفع مستند عرض السعر بأمان.",
      "invoice-document-uploaded": "تم رفع الفاتورة أو المستند المساند بأمان لمراجعة فريق مالية أكسورا.",
    },
    summaryLabel: "ملخص قائمة المورد", assignedRfqs: "طلبات عروض الأسعار المسندة", actionable: "تتطلب إجراءً",
    submittedQuotations: "عروض الأسعار المقدمة", emptyTitle: "لا توجد طلبات عروض أسعار",
    emptyBody: "ستظهر هنا طلبات عروض الأسعار الجديدة المسندة إلى مؤسستك.", quantity: "الكمية",
    respondBy: "آخر موعد للرد", latestResponse: "أحدث رد",
    quotationVersion: (version, status) => `الإصدار ${version} · ${status}`,
    notSubmitted: "لم يقدم", quotedUnitPrice: "سعر الوحدة المعروض", specification: "المواصفات",
    documents: "المستندات", documentVersion: (kind, version) => `${kind} · الإصدار ${version}`,
    acknowledgeSummary: "تأكيد الطلب أو طلب استيضاح", response: "الرد", acknowledge: "تأكيد الاستلام",
    requestClarification: "طلب استيضاح", decline: "رفض", note: "ملاحظة",
    buyerContextPlaceholder: "سياق اختياري للمشتري", recordResponse: "تسجيل الرد",
    submitRevised: "تقديم عرض سعر منقح", submitQuotation: "تقديم عرض سعر",
    quotationReference: "مرجع عرض السعر", unitPrice: "سعر الوحدة (ر.م)",
    deliveryCharge: "رسوم التسليم (ر.م)",
    leadTimeDays: "مدة التجهيز (بالأيام)", validUntil: "صالح حتى", commercialNote: "ملاحظة تجارية",
    submitVersioned: "تقديم عرض السعر وحفظ إصداره", uploadSummary: "رفع مستند عرض السعر",
    pdfOrImage: "ملف PDF أو صورة", uploadHint: "الحد الأقصى 5 ميجابايت. يتم التحقق من الملفات ولا تتاح إلا لحساب المورد الخاص بك.",
    uploadDocument: "رفع المستند", noDeadline: "لا يوجد موعد نهائي",
    profileTitle: "ملف المورد", profileIntro: "هذا هو سجل المورد الخاص لدى أكسورا لمؤسستك. تواصل مع عمليات أكسورا إذا كانت أي معلومة قديمة.",
    contact: "جهة الاتصال الرئيسية", category: "الفئة", coverage: "نطاق التغطية", address: "العنوان",
    paymentTerms: "شروط الدفع", standardLeadTime: "مدة التجهيز المعتادة", mainProducts: "المنتجات الرئيسية",
    selectedOrder: "طلب مختار", selectedOrderHelp: "اختارت أكسورا عرضكم. أكد الطلب أدناه؛ وتبقى تكلفة شراء العميل وهامش أكسورا الخاص مخفيين.",
    selectedOrderResponse: "تأكيد الطلب المختار", availability: "التوفر",
    availabilityLabels: { AVAILABLE: "متوفر", PARTIAL: "متوفر جزئيًا", MADE_TO_ORDER: "يصنع حسب الطلب", OUT_OF_STOCK: "غير متوفر" },
    responseHistory: "سجل الردود والاستيضاحات", noResponseNote: "لا توجد ملاحظة",
    invoiceTitle: "فواتير المورد وحالة الدفع", invoiceIntro: "تظهر هنا فقط الفواتير التي سجلها فريق مالية أكسورا لمؤسستك.",
    invoiceNumber: "الفاتورة", order: "الطلب", amount: "المبلغ", paymentStatus: "حالة الدفع", noInvoices: "لا توجد فواتير مورد مسجلة بعد.",
    uploadInvoiceSummary: "رفع فاتورة أو مستند مساند", uploadInvoiceHint: "متاح فقط للعمل المختار. يجب أن يتحقق فريق مالية أكسورا من الفاتورة ويسجلها قبل ظهور حالة الدفع.",
  },
  driver: {
    eyebrow: "مساحة عمل السائق", title: "عمليات التسليم المسندة",
    description: "سجل تقدمك بوجود اتصال أو بدونه. تبقى تحديثات الحالة محفوظة على هذا الجهاز حتى يؤكدها الخادم.",
    eventLabels: { ACCEPTED: "تم القبول", REJECTED: "تم الرفض", EN_ROUTE: "في الطريق", ARRIVED: "وصلت", DELIVERY_ATTEMPTED: "جرت محاولة التسليم", PARTIALLY_DELIVERED: "تم التسليم جزئيًا", DELIVERED: "تم التسليم", FAILED: "تعذر التسليم", ISSUE_REPORTED: "تم الإبلاغ عن مشكلة", NOTE_ADDED: "أضيفت ملاحظة" },
    notScheduled: "غير مجدول", serverNotConfirmed: "لم يؤكد الخادم هذا التحديث.",
    allSynced: "تمت مزامنة جميع تحديثات الحالة المحفوظة.",
    syncPaused: "توقفت المزامنة مؤقتًا. ما زالت تحديثاتك محفوظة بأمان على هذا الجهاز.",
    offlineStorageUnavailable: "التخزين دون اتصال غير متاح في هذا المتصفح. فعّل تخزين الموقع قبل تسجيل تحديثات التسليم.",
    queueRecoveryRequired: "توقفت المزامنة لأن تحديثات التسليم المحفوظة تحتاج إلى استعادة. لم يتم تغيير أي شيء أو حذفه.",
    queueRecoveryResolved: "أصبحت قائمة التسليم المحفوظة صالحة مجددًا ويمكن متابعة المزامنة.",
    queueReloaded: "تغيرت تحديثات التسليم المحفوظة في علامة تبويب أخرى لأكسورا. أعيد تحميل هذا العرض بأمان قبل المزامنة.",
    queueRecoveryExported: "تم تنزيل ملف استعادة خاص. احتفظ به بأمان ولا تشاركه إلا مع دعم أكسورا المخول.",
    queueRecoveryDiscarded: "تم التخلص من النسخة المحلية التالفة بعد التأكيد. يمكنك الآن تسجيل تحديثات تسليم جديدة.",
    queueRecoveryTitle: "تحديثات التسليم المحفوظة تحتاج إلى انتباه",
    queueRecoveryBody: "تعذر على أكسورا التحقق بأمان من قائمة الانتظار المحفوظة كاملة. تم إيقاف المزامنة والتحديثات الجديدة دون اتصال كي لا تتم الكتابة فوق البيانات الأصلية.",
    queueRecoveryDetail: (validCount, totalCount) => totalCount === undefined
      ? "تعذرت قراءة البيانات المحفوظة. لم يتم تغيير أي عنصر محفوظ."
      : `اجتاز التحقق ${validCount} من أصل ${totalCount} عنصرًا محفوظًا. لن تتم مزامنة أي عنصر حتى تصبح القائمة كاملة آمنة.`,
    queueRecoveryPrivacy: "نزّل ملف الاستعادة قبل التخلص من البيانات إذا كان الدعم قد يحتاجه. قد يحتوي على ملاحظات تسليم خاصة، لذا احفظه وشاركه بأمان.",
    retryQueueValidation: "إعادة التحقق",
    exportQueueRecovery: "تنزيل ملف الاستعادة",
    discardQueueRecovery: "التخلص من النسخة المحلية",
    confirmDiscardTitle: "هل تريد التخلص من هذه النسخة المحفوظة؟",
    confirmDiscardBody: "سيؤدي ذلك إلى إزالة قائمة الانتظار من هذا المتصفح ولا يمكن التراجع عنه هنا. نزّل ملف الاستعادة أولًا إذا كان أي تحديث ما زال مطلوبًا.",
    cancelDiscard: "الاحتفاظ بالنسخة",
    confirmDiscard: "تأكيد التخلص",
    alreadyLatest: (status) => `${status} هي أحدث حالة محفوظة بالفعل.`,
    statusSavedSyncing: "تم حفظ الحالة. تجري المزامنة الآن…",
    statusSavedOffline: "تم حفظ الحالة على هذا الجهاز. ستتم مزامنتها عند عودة الاتصال.",
    updateNotSaved: "تعذر حفظ تحديث التسليم على هذا الجهاز.",
    uploadingEvidence: "جارٍ رفع الدليل…", evidenceUploadFailed: "تعذر رفع الدليل.",
    evidenceUploaded: "تم رفع الدليل بأمان.", evidenceRetry: "اختر الملف نفسه لإعادة المحاولة بأمان.",
    evidencePausedRetry: "توقف رفع الدليل مؤقتًا. اختر الملف نفسه لإعادة المحاولة بأمان.",
    offline: "غير متصل", syncing: "جارٍ المزامنة", online: "متصل",
    updatesWaiting: (count) => `${count} تحديث قيد الانتظار`, syncNow: "المزامنة الآن",
    emptyTitle: "لا توجد مهام نشطة", emptyBody: "ستظهر هنا مهام التسليم المسندة إليك.",
    windowStarts: "بداية نافذة التسليم", windowEnds: "نهاية نافذة التسليم", packages: "الطرود", instructions: "التعليمات", navigate: "فتح الملاحة",
    updateJob: (jobCode) => `تحديث ${jobCode}`, accept: "قبول", reject: "رفض", enRoute: "في الطريق",
    arrived: "وصلت", attempted: "تمت المحاولة", partiallyDelivered: "تسليم جزئي", delivered: "تم التسليم", failed: "تعذر التسليم",
    deliveryOutcome: "تسجيل نتيجة التسليم", reportedReceiverName: "الاسم المذكور عند التسليم",
    deliveredQuantity: "المسلّم", damagedQuantity: "التالف", missingQuantity: "المفقود",
    evidenceOnly: "هذا دليل سجله السائق فقط. يؤكد مستلم العميل القبول بصورة مستقلة.",
    issueReport: "محاولة أو مشكلة تسليم", issueReason: "السبب",
    issueLabels: { CUSTOMER_UNAVAILABLE: "العميل غير متاح", ACCESS_BLOCKED: "تعذر الدخول", ADDRESS_PROBLEM: "مشكلة في العنوان", DAMAGED_ITEMS: "أصناف تالفة", MISSING_ITEMS: "أصناف مفقودة", VEHICLE_PROBLEM: "مشكلة في المركبة", SAFETY_CONCERN: "مخاوف تتعلق بالسلامة", OTHER: "أخرى" },
    issueNote: "ماذا حدث؟", issueNotePlaceholder: "أضف وصفًا تشغيليًا موجزًا",
    recordAttempt: "تسجيل محاولة التسليم", reportIssue: "الإبلاغ عن مشكلة",
    queuedUpdates: (count) => `${count} تحديث محفوظ بأمان في قائمة الانتظار على هذا الجهاز.`,
    lastConfirmed: (date) => `آخر تأكيد: ${date}.`, noStatus: "لم تسجل أي حالة بعد.",
    addNote: "إضافة ملاحظة للسائق", operationalNote: "ملاحظة تشغيلية", saveNoteOffline: "حفظ الملاحظة دون اتصال",
    uploadEvidence: "رفع دليل التسليم", photoOrDeliveryNote: "صورة أو سند تسليم",
    syncBeforeEvidence: "زامن أحدث حالة قبل إرفاق دليل بها.",
    evidenceHint: "الحد الأقصى 5 ميجابايت. يدعم الدليل سجل السائق، ويؤكد المستلم الكميات بشكل منفصل.",
    uploadEvidenceButton: "رفع الدليل",
  },
  receiving: {
    eyebrow: "استلام العميل", title: "تأكيد الكميات المسلمة",
    description: "افحص كل بند بشكل مستقل. صور السائق وسندات التسليم أدلة مساندة وليست قبولًا من العميل.",
    receiptConfirmedNotice: "تم تأكيد الاستلام وتسجيله بشكل مستقل عن دليل السائق.",
    summaryLabel: "ملخص الاستلام", deliveredJobs: "عمليات التسليم المسجلة", awaitingConfirmation: "بانتظار التأكيد",
    confirmed: "مؤكد", emptyTitle: "لا توجد عمليات تسليم مسجلة",
    emptyBody: "تظهر المهمة هنا فقط بعد أن يسجل السائق عملية التسليم.",
    awaitingDriverEvent: "بانتظار تسجيل السائق للتسليم", driverRecorded: "سجل السائق:",
    driverReportedReceiver: "اسم التسليم الذي سجله السائق", driverEvidenceOnly: "دليل سائق مساند فقط — وليس قبولًا من العميل.",
    driverReportedQuantity: "ما سجله السائق", missing: "مفقود", confirmingAs: (name) => `أنت تؤكد الاستلام باسم ${name}.`,
    receiptComplete: "اكتمل استلام العميل", receiptId: "معرف الاستلام",
    readOnlyTitle: "عرض الاستلام للقراءة فقط", readOnlyBody: "يجب أن يفحص مستخدم استلام مخول لدى العميل كل بند ويؤكده.",
    inspectLines: (count) => `افحص جميع البنود (${count})`,
    quantityRule: "يجب أن يساوي مجموع المقبول والمرفوض الكمية التي شاهدت تسليمها.",
    planned: "المخطط", delivered: "المسلم", accepted: "المقبول", damaged: "التالف",
    inspectionClassification: "تصنيف الفحص", noManualException: "لا يوجد استثناء يدوي",
    wrongItem: "صنف غير صحيح", qualityIssue: "مشكلة في الجودة", otherException: "استثناء آخر",
    lineNote: "ملاحظة البند", discrepancyPlaceholder: "صف التلف أو مشكلة الجودة أو أي اختلاف آخر",
    receiptNotes: "ملاحظات الاستلام", receiptNotesPlaceholder: "ملاحظة اختيارية عن التسليم بالكامل",
    confirmationExplanation: "عند التأكيد، تنشئ سجل استلام العميل. لا يغير ذلك دليل السائق.",
    confirmReceipt: "تأكيد استلام العميل",
  },
};

const malay: RolePortalMessages = {
  statuses: {
    CREATED: "Dicipta", ISSUED: "Dikeluarkan", VIEWED: "Dilihat", ACKNOWLEDGED: "Diakui",
    RESPONDED: "Dijawab", DECLINED: "Ditolak", WITHDRAWN: "Ditarik balik", EXPIRED: "Tamat tempoh",
    CLOSED: "Ditutup", SUBMITTED: "Dihantar", REVISED: "Disemak", ASSIGNED: "Ditugaskan",
    ACCEPTED: "Diterima", REJECTED: "Ditolak", REASSIGNED: "Ditugaskan semula", CANCELLED: "Dibatalkan",
    COMPLETED: "Selesai", EN_ROUTE: "Dalam perjalanan", ARRIVED: "Tiba", DELIVERED: "Dihantar",
    DELIVERY_ATTEMPTED: "Penghantaran dicuba", PARTIALLY_DELIVERED: "Dihantar sebahagian",
    FAILED: "Gagal", ISSUE_REPORTED: "Isu dilaporkan", NOTE_ADDED: "Nota ditambah", CONFIRMED: "Disahkan",
    AWAITING_CONFIRMATION: "Menunggu pengesahan", RFQ: "RFQ", QUOTATION: "Sebut harga",
    ACKNOWLEDGEMENT: "Pengakuan", CLARIFICATION: "Penjelasan", SUPPORTING: "Sokongan",
  },
  supplier: {
    eyebrow: "Ruang kerja pembekal",
    description: "Semak hanya permintaan sebut harga yang ditugaskan kepada organisasi anda, akui setiap permintaan, dan hantar respons komersial yang mempunyai versi.",
    notices: {
      "acknowledgement-recorded": "Respons RFQ anda telah direkodkan.",
      "quotation-submitted": "Sebut harga anda telah dihantar dan disimpan sebagai versi.",
      "document-uploaded": "Dokumen sebut harga anda telah dimuat naik dengan selamat.",
      "invoice-document-uploaded": "Invois atau dokumen sokongan anda dimuat naik dengan selamat untuk semakan kewangan Axora.",
    },
    summaryLabel: "Ringkasan giliran pembekal", assignedRfqs: "RFQ ditugaskan", actionable: "Perlu tindakan",
    submittedQuotations: "Sebut harga dihantar", emptyTitle: "Tiada permintaan sebut harga",
    emptyBody: "RFQ baharu yang ditugaskan kepada organisasi anda akan dipaparkan di sini.", quantity: "Kuantiti",
    respondBy: "Jawab sebelum", latestResponse: "Respons terkini",
    quotationVersion: (version, status) => `Versi ${version} · ${status}`,
    notSubmitted: "Belum dihantar", quotedUnitPrice: "Harga unit disebut", specification: "Spesifikasi",
    documents: "Dokumen", documentVersion: (kind, version) => `${kind} · versi ${version}`,
    acknowledgeSummary: "Akui atau tanya tentang RFQ", response: "Respons", acknowledge: "Akui penerimaan",
    requestClarification: "Minta penjelasan", decline: "Tolak", note: "Nota",
    buyerContextPlaceholder: "Konteks pilihan untuk pembeli", recordResponse: "Rekod respons",
    submitRevised: "Hantar sebut harga disemak", submitQuotation: "Hantar sebut harga",
    quotationReference: "Rujukan sebut harga", unitPrice: "Harga unit (MYR)",
    deliveryCharge: "Caj penghantaran (MYR)",
    leadTimeDays: "Tempoh siap (hari)", validUntil: "Sah sehingga", commercialNote: "Nota komersial",
    submitVersioned: "Hantar sebut harga berversi", uploadSummary: "Muat naik dokumen sebut harga",
    pdfOrImage: "PDF atau imej", uploadHint: "Maksimum 5 MB. Fail disahkan dan hanya tersedia kepada akaun pembekal anda.",
    uploadDocument: "Muat naik dokumen", noDeadline: "Tiada tarikh akhir",
    profileTitle: "Profil pembekal", profileIntro: "Ini ialah rekod pembekal Axora persendirian untuk organisasi anda. Hubungi operasi Axora jika butiran sudah lapuk.",
    contact: "Hubungan utama", category: "Kategori", coverage: "Liputan", address: "Alamat",
    paymentTerms: "Terma bayaran", standardLeadTime: "Tempoh siap standard", mainProducts: "Produk utama",
    selectedOrder: "Pesanan dipilih", selectedOrderHelp: "Axora memilih sebut harga anda. Akui pesanan di bawah; kos belian pelanggan dan margin peribadi Axora kekal tersembunyi.",
    selectedOrderResponse: "Akui pesanan dipilih", availability: "Ketersediaan",
    availabilityLabels: { AVAILABLE: "Tersedia", PARTIAL: "Tersedia sebahagian", MADE_TO_ORDER: "Dibuat mengikut pesanan", OUT_OF_STOCK: "Kehabisan stok" },
    responseHistory: "Sejarah respons dan penjelasan", noResponseNote: "Tiada nota diberikan",
    invoiceTitle: "Invois pembekal dan status bayaran", invoiceIntro: "Hanya invois yang didaftarkan oleh kewangan Axora untuk organisasi pembekal anda dipaparkan.",
    invoiceNumber: "Invois", order: "Pesanan", amount: "Amaun", paymentStatus: "Status bayaran", noInvoices: "Belum ada invois pembekal berdaftar.",
    uploadInvoiceSummary: "Muat naik invois atau dokumen sokongan", uploadInvoiceHint: "Tersedia hanya untuk kerja dipilih. Kewangan Axora masih perlu mengesahkan dan mendaftarkan invois sebelum status bayaran muncul.",
  },
  driver: {
    eyebrow: "Ruang kerja pemandu", title: "Penghantaran ditugaskan",
    description: "Rekod kemajuan dengan atau tanpa isyarat. Peristiwa status kekal pada peranti ini sehingga disahkan oleh pelayan.",
    eventLabels: { ACCEPTED: "Diterima", REJECTED: "Ditolak", EN_ROUTE: "Dalam perjalanan", ARRIVED: "Tiba", DELIVERY_ATTEMPTED: "Penghantaran dicuba", PARTIALLY_DELIVERED: "Dihantar sebahagian", DELIVERED: "Dihantar", FAILED: "Gagal", ISSUE_REPORTED: "Isu dilaporkan", NOTE_ADDED: "Nota ditambah" },
    notScheduled: "Belum dijadualkan", serverNotConfirmed: "Pelayan tidak mengesahkan kemas kini ini.",
    allSynced: "Semua kemas kini status yang disimpan telah disegerakkan.",
    syncPaused: "Penyegerakan dijeda. Kemas kini anda masih selamat pada peranti ini.",
    offlineStorageUnavailable: "Storan luar talian tidak tersedia dalam pelayar ini. Dayakan storan tapak sebelum merekod kemas kini penghantaran.",
    queueRecoveryRequired: "Penyegerakan dijeda kerana kemas kini penghantaran tersimpan perlu dipulihkan. Tiada apa-apa diubah atau dipadam.",
    queueRecoveryResolved: "Giliran penghantaran tersimpan sah semula. Penyegerakan boleh diteruskan.",
    queueReloaded: "Kemas kini penghantaran tersimpan berubah dalam tab Axora lain. Paparan ini dimuat semula dengan selamat sebelum penyegerakan.",
    queueRecoveryExported: "Fail pemulihan peribadi telah dimuat turun. Simpan dengan selamat dan kongsi hanya dengan sokongan Axora yang dibenarkan.",
    queueRecoveryDiscarded: "Salinan tempatan yang rosak telah dibuang selepas pengesahan. Kemas kini penghantaran baharu kini boleh direkodkan.",
    queueRecoveryTitle: "Kemas kini penghantaran tersimpan memerlukan perhatian",
    queueRecoveryBody: "Axora tidak dapat mengesahkan keseluruhan giliran tersimpan dengan selamat. Penyegerakan automatik dan kemas kini luar talian baharu dijeda supaya data asal tidak ditulis ganti.",
    queueRecoveryDetail: (validCount, totalCount) => totalCount === undefined
      ? "Data tersimpan tidak dapat dibaca. Tiada item tersimpan diubah."
      : `${validCount} daripada ${totalCount} item tersimpan lulus pengesahan. Tiada item akan disegerakkan sehingga keseluruhan giliran selamat.`,
    queueRecoveryPrivacy: "Muat turun fail pemulihan sebelum membuang jika sokongan mungkin memerlukannya. Fail boleh mengandungi nota penghantaran peribadi, jadi simpan dan kongsikannya dengan selamat.",
    retryQueueValidation: "Cuba pengesahan semula",
    exportQueueRecovery: "Muat turun fail pemulihan",
    discardQueueRecovery: "Buang salinan tempatan",
    confirmDiscardTitle: "Buang salinan tersimpan ini?",
    confirmDiscardBody: "Ini mengalih keluar giliran daripada pelayar ini dan tidak boleh dibuat asal di sini. Muat turun fail pemulihan dahulu jika mana-mana kemas kini masih diperlukan.",
    cancelDiscard: "Simpan salinan",
    confirmDiscard: "Sahkan buang",
    alreadyLatest: (status) => `${status} sudah menjadi status tersimpan yang terkini.`,
    statusSavedSyncing: "Status disimpan. Menyegerak sekarang…",
    statusSavedOffline: "Status disimpan pada peranti ini. Ia akan disegerakkan apabila anda kembali dalam talian.",
    updateNotSaved: "Kemas kini penghantaran tidak dapat disimpan pada peranti ini.",
    uploadingEvidence: "Memuat naik bukti…", evidenceUploadFailed: "Muat naik bukti gagal.",
    evidenceUploaded: "Bukti dimuat naik dengan selamat.", evidenceRetry: "Pilih fail yang sama untuk cuba semula dengan selamat.",
    evidencePausedRetry: "Muat naik bukti dijeda. Pilih fail yang sama untuk cuba semula dengan selamat.",
    offline: "Luar talian", syncing: "Menyegerak", online: "Dalam talian",
    updatesWaiting: (count) => `${count} kemas kini menunggu`, syncNow: "Segerak sekarang",
    emptyTitle: "Tiada tugasan aktif", emptyBody: "Kerja penghantaran yang ditugaskan kepada anda akan dipaparkan di sini.",
    windowStarts: "Mula tetingkap", windowEnds: "Tamat tetingkap", packages: "Bungkusan", instructions: "Arahan", navigate: "Buka navigasi",
    updateJob: (jobCode) => `Kemas kini ${jobCode}`, accept: "Terima", reject: "Tolak", enRoute: "Dalam perjalanan",
    arrived: "Tiba", attempted: "Percubaan", partiallyDelivered: "Dihantar sebahagian", delivered: "Dihantar", failed: "Gagal",
    deliveryOutcome: "Rekod hasil serahan", reportedReceiverName: "Nama yang diberi semasa serahan",
    deliveredQuantity: "Dihantar", damagedQuantity: "Rosak", missingQuantity: "Hilang",
    evidenceOnly: "Ini hanya bukti yang dilaporkan pemandu. Penerima pelanggan mengesahkan penerimaan secara berasingan.",
    issueReport: "Percubaan atau isu penghantaran", issueReason: "Sebab",
    issueLabels: { CUSTOMER_UNAVAILABLE: "Pelanggan tidak tersedia", ACCESS_BLOCKED: "Akses terhalang", ADDRESS_PROBLEM: "Masalah alamat", DAMAGED_ITEMS: "Item rosak", MISSING_ITEMS: "Item hilang", VEHICLE_PROBLEM: "Masalah kenderaan", SAFETY_CONCERN: "Kebimbangan keselamatan", OTHER: "Lain-lain" },
    issueNote: "Apa yang berlaku?", issueNotePlaceholder: "Tambah penerangan operasi yang ringkas",
    recordAttempt: "Rekod percubaan penghantaran", reportIssue: "Lapor isu",
    queuedUpdates: (count) => `${count} kemas kini selamat dalam giliran pada peranti ini.`,
    lastConfirmed: (date) => `Terakhir disahkan ${date}.`, noStatus: "Belum ada status direkodkan.",
    addNote: "Tambah nota pemandu", operationalNote: "Nota operasi", saveNoteOffline: "Simpan nota luar talian",
    uploadEvidence: "Muat naik bukti pemandu", photoOrDeliveryNote: "Foto atau nota penghantaran",
    syncBeforeEvidence: "Segerakkan status terkini sebelum melampirkan bukti kepadanya.",
    evidenceHint: "Maksimum 5 MB. Bukti menyokong garis masa pemandu; penerima mengesahkan kuantiti secara berasingan.",
    uploadEvidenceButton: "Muat naik bukti",
  },
  receiving: {
    eyebrow: "Penerimaan pelanggan", title: "Sahkan kuantiti dihantar",
    description: "Periksa setiap baris secara berasingan. Foto pemandu dan nota penghantaran ialah bukti sokongan, bukan penerimaan pelanggan.",
    receiptConfirmedNotice: "Penerimaan disahkan dan direkodkan secara berasingan daripada bukti pemandu.",
    summaryLabel: "Ringkasan penerimaan", deliveredJobs: "Kerja dihantar", awaitingConfirmation: "Menunggu pengesahan",
    confirmed: "Disahkan", emptyTitle: "Tiada kerja dihantar",
    emptyBody: "Kerja hanya dipaparkan di sini selepas pemandu yang ditugaskan merekodkan penghantaran.",
    awaitingDriverEvent: "Menunggu peristiwa penghantaran pemandu", driverRecorded: "Pemandu merekodkan:",
    driverReportedReceiver: "Nama serahan dilaporkan pemandu", driverEvidenceOnly: "Bukti sokongan pemandu sahaja — bukan penerimaan pelanggan.",
    driverReportedQuantity: "Dilaporkan pemandu", missing: "hilang", confirmingAs: (name) => `Anda mengesahkan sebagai ${name}.`,
    receiptComplete: "Penerimaan pelanggan selesai", receiptId: "ID penerimaan",
    readOnlyTitle: "Paparan penerimaan baca sahaja", readOnlyBody: "Pengguna penerimaan pelanggan yang berskop mesti memeriksa dan mengesahkan setiap baris.",
    inspectLines: (count) => `Periksa semua ${count} baris`,
    quantityRule: "Jumlah diterima dan ditolak mesti sama dengan kuantiti yang anda lihat dihantar.",
    planned: "Dirancang", delivered: "Dihantar", accepted: "Diterima", damaged: "Rosak",
    inspectionClassification: "Klasifikasi pemeriksaan", noManualException: "Tiada pengecualian manual",
    wrongItem: "Item salah", qualityIssue: "Isu kualiti", otherException: "Pengecualian lain",
    lineNote: "Nota baris", discrepancyPlaceholder: "Terangkan kerosakan, kualiti atau perbezaan lain",
    receiptNotes: "Nota penerimaan", receiptNotesPlaceholder: "Nota pilihan tentang keseluruhan penghantaran",
    confirmationExplanation: "Dengan mengesahkan, anda mencipta rekod penerimaan pelanggan. Ini tidak mengubah bukti pemandu.",
    confirmReceipt: "Sahkan penerimaan pelanggan",
  },
};

export const ROLE_PORTAL_MESSAGES: Record<SupportedLocale, RolePortalMessages> = {
  en: english,
  ar: arabic,
  ms: malay,
};

export function rolePortalMessages(locale: SupportedLocale = "en") {
  return ROLE_PORTAL_MESSAGES[locale];
}

export function formatRolePortalStatus(value: string | undefined, locale: SupportedLocale = "en") {
  if (!value) return "—";
  return ROLE_PORTAL_MESSAGES[locale].statuses[value]
    ?? value.toLocaleLowerCase(INTL_LOCALES[locale]).replaceAll("_", " ");
}

export function formatRolePortalDate(
  value: string | undefined,
  locale: SupportedLocale = "en",
  fallback = ROLE_PORTAL_MESSAGES[locale].supplier.noDeadline,
  timeZone = "Asia/Kuala_Lumpur",
) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(INTL_LOCALES[locale], { dateStyle: "medium", timeZone }).format(date);
}

export function formatRolePortalDateTime(
  value: string | undefined,
  locale: SupportedLocale = "en",
  fallback = ROLE_PORTAL_MESSAGES[locale].driver.notScheduled,
  timeZone = "Asia/Kuala_Lumpur",
) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(INTL_LOCALES[locale], { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
}

export function formatRolePortalNumber(value: number, locale: SupportedLocale = "en") {
  return new Intl.NumberFormat(INTL_LOCALES[locale], { maximumFractionDigits: 3 }).format(value);
}

export function formatRolePortalMoney(value: number | undefined, locale: SupportedLocale = "en") {
  if (value === undefined) return "—";
  return new Intl.NumberFormat(INTL_LOCALES[locale], { style: "currency", currency: "MYR" }).format(value);
}

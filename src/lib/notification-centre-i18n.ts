import type { SupportedLocale } from "./i18n";
import type { NotificationCategory } from "./notifications";

export interface NotificationCentreMessages {
  eyebrow: string;
  title: string;
  description: string;
  loading: string;
  errorTitle: string;
  errorBody: string;
  unreadMetric: string;
  visibleMetric: string;
  deliveryMetric: string;
  filters: string;
  status: string;
  type: string;
  apply: string;
  allStatuses: string;
  allTypes: string;
  unread: string;
  read: string;
  archived: string;
  inbox: string;
  current: string;
  unreadCount: (count: number) => string;
  markAll: string;
  markRead: string;
  archive: string;
  open: string;
  saving: string;
  reminder: string;
  emailRelated: string;
  expires: (date: string) => string;
  empty: string;
  emptyBody: string;
  preferences: string;
  preferencesIntro: string;
  inAppLocked: string;
  inAppLockedBody: string;
  personalChoice: string;
  companyDefault: string;
  email: string;
  schedule: string;
  reminderSchedule: string;
  noReminder: string;
  hours12: string;
  hours24: string;
  hours72: string;
  hours168: string;
  immediate: string;
  daily: string;
  weekly: string;
  mandatory: string;
  optional: string;
  save: string;
  saved: string;
  denied: string;
  live: string;
  categories: Record<NotificationCategory, string>;
  eventLabels: Record<string, string>;
}

const eventLabels = {
  en: {
    "invitation.sent": "Account invitation",
    "invitation.accepted": "Invitation accepted",
    "password.changed": "Password changed",
    "email.verification": "Email verification",
    "company.lead.created": "Company lead created",
    "company.lead.submitted": "Website enquiry received",
    "company.lead.assigned": "Lead assigned",
    "company.lead.reassigned": "Lead reassigned",
    "company.lead.contacted": "Lead contacted",
    "company.lead.information_requested": "Lead information requested",
    "company.lead.qualified": "Lead qualified",
    "company.lead.converted": "Lead converted",
    "company.lead.rejected": "Lead rejected",
    "company.lead.archived": "Lead archived",
    "company.lead.sla_overdue": "Lead follow-up overdue",
    "request.submitted": "Request submitted",
    "request.status_changed": "Request status changed",
    "request.approved": "Request approved",
    "request.rejected": "Request rejected",
    "approval.needed": "Approval required",
    "approval.company_required": "Company approval required",
    "budget.low": "Budget running low",
    "budget.zero": "Budget exhausted",
    "budget.refreshed": "Budget refreshed",
    "budget.refresh_failed": "Budget refresh failed",
    "quotation.requested": "Quotation requested",
    "quotation.received": "Quotation received",
    "supplier.selected": "Supplier selected",
    "supplier.order_selected": "Supplier order selected",
    "supplier.order_acknowledged": "Supplier order acknowledged",
    "supplier.rfq_acknowledged": "RFQ acknowledged",
    "delivery.scheduled": "Delivery scheduled",
    "driver.assigned": "Driver assigned",
    "delivery.out_for_delivery": "Out for delivery",
    "delivery.arrived": "Delivery arrived",
    "delivery.completed": "Delivery completed",
    "receipt.required": "Receipt confirmation required",
    "receipt.confirmed": "Receipt confirmed",
    "discrepancy.opened": "Delivery discrepancy opened",
    "invoice.issued": "Invoice issued",
    "payment.status_changed": "Payment status changed",
    "three_way_match.completed": "Three-way match completed",
    "three_way_match.exception": "Three-way match exception",
    "email.hard_bounce": "Email delivery failure",
  },
  ar: {
    "invitation.sent": "دعوة الحساب",
    "invitation.accepted": "تم قبول الدعوة",
    "password.changed": "تم تغيير كلمة المرور",
    "email.verification": "التحقق من البريد الإلكتروني",
    "company.lead.created": "تم إنشاء عميل محتمل",
    "company.lead.submitted": "تم استلام استفسار الموقع",
    "company.lead.assigned": "تم إسناد العميل المحتمل",
    "company.lead.reassigned": "أُعيد إسناد العميل المحتمل",
    "company.lead.contacted": "تم التواصل مع العميل المحتمل",
    "company.lead.information_requested": "طُلبت معلومات العميل المحتمل",
    "company.lead.qualified": "تم تأهيل العميل المحتمل",
    "company.lead.converted": "تم تحويل العميل المحتمل",
    "company.lead.rejected": "تم رفض العميل المحتمل",
    "company.lead.archived": "تمت أرشفة العميل المحتمل",
    "company.lead.sla_overdue": "تأخرت متابعة العميل المحتمل",
    "request.submitted": "تم إرسال الطلب",
    "request.status_changed": "تغيرت حالة الطلب",
    "request.approved": "تم اعتماد الطلب",
    "request.rejected": "تم رفض الطلب",
    "approval.needed": "مطلوب اعتماد",
    "approval.company_required": "مطلوب اعتماد الشركة",
    "budget.low": "الميزانية منخفضة",
    "budget.zero": "نُفدت الميزانية",
    "budget.refreshed": "تم تجديد الميزانية",
    "budget.refresh_failed": "فشل تجديد الميزانية",
    "quotation.requested": "طُلب عرض سعر",
    "quotation.received": "تم استلام عرض سعر",
    "supplier.selected": "تم اختيار المورد",
    "supplier.order_selected": "تم اختيار طلب المورد",
    "supplier.order_acknowledged": "أكد المورد الطلب",
    "supplier.rfq_acknowledged": "تم تأكيد طلب عرض السعر",
    "delivery.scheduled": "تمت جدولة التسليم",
    "driver.assigned": "تم إسناد السائق",
    "delivery.out_for_delivery": "خرج الطلب للتسليم",
    "delivery.arrived": "وصل التسليم",
    "delivery.completed": "اكتمل التسليم",
    "receipt.required": "مطلوب تأكيد الاستلام",
    "receipt.confirmed": "تم تأكيد الاستلام",
    "discrepancy.opened": "فُتح اختلاف في التسليم",
    "invoice.issued": "صدرت الفاتورة",
    "payment.status_changed": "تغيرت حالة الدفع",
    "three_way_match.completed": "اكتملت المطابقة الثلاثية",
    "three_way_match.exception": "استثناء في المطابقة الثلاثية",
    "email.hard_bounce": "تعذر تسليم البريد الإلكتروني",
  },
  ms: {
    "invitation.sent": "Jemputan akaun",
    "invitation.accepted": "Jemputan diterima",
    "password.changed": "Kata laluan ditukar",
    "email.verification": "Pengesahan e-mel",
    "company.lead.created": "Prospek syarikat dicipta",
    "company.lead.submitted": "Pertanyaan laman diterima",
    "company.lead.assigned": "Prospek ditugaskan",
    "company.lead.reassigned": "Prospek ditugaskan semula",
    "company.lead.contacted": "Prospek dihubungi",
    "company.lead.information_requested": "Maklumat prospek diminta",
    "company.lead.qualified": "Prospek dilayakkan",
    "company.lead.converted": "Prospek ditukar",
    "company.lead.rejected": "Prospek ditolak",
    "company.lead.archived": "Prospek diarkibkan",
    "company.lead.sla_overdue": "Susulan prospek lewat",
    "request.submitted": "Permintaan dihantar",
    "request.status_changed": "Status permintaan berubah",
    "request.approved": "Permintaan diluluskan",
    "request.rejected": "Permintaan ditolak",
    "approval.needed": "Kelulusan diperlukan",
    "approval.company_required": "Kelulusan syarikat diperlukan",
    "budget.low": "Bajet semakin rendah",
    "budget.zero": "Bajet habis",
    "budget.refreshed": "Bajet diperbaharui",
    "budget.refresh_failed": "Pembaruan bajet gagal",
    "quotation.requested": "Sebut harga diminta",
    "quotation.received": "Sebut harga diterima",
    "supplier.selected": "Pembekal dipilih",
    "supplier.order_selected": "Pesanan pembekal dipilih",
    "supplier.order_acknowledged": "Pesanan diakui pembekal",
    "supplier.rfq_acknowledged": "RFQ diakui",
    "delivery.scheduled": "Penghantaran dijadualkan",
    "driver.assigned": "Pemandu ditugaskan",
    "delivery.out_for_delivery": "Sedang dihantar",
    "delivery.arrived": "Penghantaran tiba",
    "delivery.completed": "Penghantaran selesai",
    "receipt.required": "Pengesahan penerimaan diperlukan",
    "receipt.confirmed": "Penerimaan disahkan",
    "discrepancy.opened": "Percanggahan penghantaran dibuka",
    "invoice.issued": "Invois dikeluarkan",
    "payment.status_changed": "Status bayaran berubah",
    "three_way_match.completed": "Padanan tiga hala selesai",
    "three_way_match.exception": "Pengecualian padanan tiga hala",
    "email.hard_bounce": "Penghantaran e-mel gagal",
  },
} as const;

const en: NotificationCentreMessages = {
  eyebrow: "Personal workflow", title: "Notification centre",
  description: "A private, persistent record of the work updates currently authorized for your account.",
  loading: "Loading your notification centre…", errorTitle: "Notifications are temporarily unavailable",
  errorBody: "No notification content was shown. Refresh or try again shortly.",
  unreadMetric: "Unread", visibleMetric: "Matching updates", deliveryMetric: "Live sync",
  filters: "Filter notifications", status: "Status", type: "Type", apply: "Apply filters",
  allStatuses: "All statuses", allTypes: "All types", unread: "Unread", read: "Read", archived: "Archived",
  inbox: "Activity inbox", current: "You are up to date", unreadCount: (count) => `${count} unread update${count === 1 ? "" : "s"}`,
  markAll: "Mark all read", markRead: "Mark read", archive: "Dismiss", open: "Open authorized record", saving: "Saving…",
  reminder: "Reminder", emailRelated: "Email also queued", expires: (date) => `Retained until ${date}`,
  empty: "No matching notifications", emptyBody: "Assignments, decisions, deliveries, receipts, and exceptions appear here when they are relevant to your current role.",
  preferences: "Delivery preferences", preferencesIntro: "In-app evidence is always retained. Configure optional email timing and reminders by event.",
  inAppLocked: "In-app delivery is always on", inAppLockedBody: "Authoritative workflow, account, and security evidence cannot be disabled.",
  personalChoice: "My preference", companyDefault: "Company default", email: "Email", schedule: "Email timing", reminderSchedule: "Reminder",
  noReminder: "Off", hours12: "After 12 hours", hours24: "After 24 hours", hours72: "After 3 days", hours168: "After 7 days",
  immediate: "Immediately", daily: "Next daily window", weekly: "Next weekly window", mandatory: "Required", optional: "Optional",
  save: "Save preference", saved: "Notification preference saved.", denied: "The notification action was unavailable.", live: "Updates sync automatically while this page is open.",
  categories: { ACCOUNT: "Account", LEAD: "Company leads", APPROVAL: "Approvals", BUDGET: "Budgets", SOURCING: "Sourcing", DELIVERY: "Delivery and receiving", FINANCE: "Finance", EMAIL: "Email delivery", WORKFLOW: "Requests" },
  eventLabels: eventLabels.en,
};

const ar: NotificationCentreMessages = {
  eyebrow: "سير العمل الشخصي", title: "مركز الإشعارات",
  description: "سجل خاص ودائم لتحديثات العمل المصرح بها حالياً لحسابك.",
  loading: "جارٍ تحميل مركز الإشعارات…", errorTitle: "الإشعارات غير متاحة مؤقتاً", errorBody: "لم يُعرض أي محتوى للإشعارات. حدّث الصفحة أو حاول بعد قليل.",
  unreadMetric: "غير مقروء", visibleMetric: "التحديثات المطابقة", deliveryMetric: "مزامنة مباشرة",
  filters: "تصفية الإشعارات", status: "الحالة", type: "النوع", apply: "تطبيق التصفية", allStatuses: "كل الحالات", allTypes: "كل الأنواع", unread: "غير مقروء", read: "مقروء", archived: "مؤرشف",
  inbox: "صندوق النشاط", current: "أنت على اطلاع", unreadCount: (count) => `${count} تحديثات غير مقروءة`, markAll: "تحديد الكل كمقروء", markRead: "تحديد كمقروء", archive: "تجاهل", open: "فتح السجل المصرح", saving: "جارٍ الحفظ…",
  reminder: "تذكير", emailRelated: "أُدرج بريد أيضاً", expires: (date) => `محفوظ حتى ${date}`, empty: "لا توجد إشعارات مطابقة", emptyBody: "تظهر هنا المهام والقرارات والتسليمات والاستلامات والاستثناءات عندما ترتبط بدورك الحالي.",
  preferences: "تفضيلات التسليم", preferencesIntro: "تبقى الأدلة داخل التطبيق دائماً. اضبط توقيت البريد والتذكيرات الاختيارية لكل حدث.", inAppLocked: "الإشعارات داخل التطبيق مفعّلة دائماً", inAppLockedBody: "لا يمكن تعطيل أدلة سير العمل والحساب والأمان الموثوقة.",
  personalChoice: "تفضيلي", companyDefault: "إعداد الشركة", email: "البريد", schedule: "توقيت البريد", reminderSchedule: "التذكير", noReminder: "إيقاف", hours12: "بعد 12 ساعة", hours24: "بعد 24 ساعة", hours72: "بعد 3 أيام", hours168: "بعد 7 أيام",
  immediate: "فوراً", daily: "النافذة اليومية التالية", weekly: "النافذة الأسبوعية التالية", mandatory: "إلزامي", optional: "اختياري", save: "حفظ التفضيل", saved: "تم حفظ تفضيل الإشعار.", denied: "تعذر تنفيذ إجراء الإشعار.", live: "تتزامن التحديثات تلقائياً أثناء فتح الصفحة.",
  categories: { ACCOUNT: "الحساب", LEAD: "عملاء الشركات المحتملون", APPROVAL: "الاعتمادات", BUDGET: "الميزانيات", SOURCING: "التوريد", DELIVERY: "التسليم والاستلام", FINANCE: "المالية", EMAIL: "تسليم البريد", WORKFLOW: "الطلبات" },
  eventLabels: eventLabels.ar,
};

const ms: NotificationCentreMessages = {
  eyebrow: "Aliran kerja peribadi", title: "Pusat pemberitahuan",
  description: "Rekod peribadi dan berterusan bagi kemas kini kerja yang kini dibenarkan untuk akaun anda.",
  loading: "Memuatkan pusat pemberitahuan…", errorTitle: "Pemberitahuan tidak tersedia buat sementara", errorBody: "Tiada kandungan pemberitahuan dipaparkan. Muat semula atau cuba sebentar lagi.",
  unreadMetric: "Belum dibaca", visibleMetric: "Kemas kini sepadan", deliveryMetric: "Segerak langsung",
  filters: "Tapis pemberitahuan", status: "Status", type: "Jenis", apply: "Gunakan penapis", allStatuses: "Semua status", allTypes: "Semua jenis", unread: "Belum dibaca", read: "Dibaca", archived: "Diarkibkan",
  inbox: "Peti masuk aktiviti", current: "Anda telah mengikuti semua kemas kini", unreadCount: (count) => `${count} kemas kini belum dibaca`, markAll: "Tandakan semua dibaca", markRead: "Tandakan dibaca", archive: "Ketepikan", open: "Buka rekod dibenarkan", saving: "Menyimpan…",
  reminder: "Peringatan", emailRelated: "E-mel turut dibariskan", expires: (date) => `Disimpan sehingga ${date}`, empty: "Tiada pemberitahuan sepadan", emptyBody: "Tugasan, keputusan, penghantaran, penerimaan dan pengecualian dipaparkan apabila berkaitan dengan peranan semasa anda.",
  preferences: "Pilihan penghantaran", preferencesIntro: "Bukti dalam aplikasi sentiasa disimpan. Tetapkan masa e-mel dan peringatan pilihan mengikut acara.", inAppLocked: "Penghantaran dalam aplikasi sentiasa aktif", inAppLockedBody: "Bukti aliran kerja, akaun dan keselamatan yang berwibawa tidak boleh dimatikan.",
  personalChoice: "Pilihan saya", companyDefault: "Tetapan syarikat", email: "E-mel", schedule: "Masa e-mel", reminderSchedule: "Peringatan", noReminder: "Tutup", hours12: "Selepas 12 jam", hours24: "Selepas 24 jam", hours72: "Selepas 3 hari", hours168: "Selepas 7 hari",
  immediate: "Serta-merta", daily: "Tetingkap harian seterusnya", weekly: "Tetingkap mingguan seterusnya", mandatory: "Wajib", optional: "Pilihan", save: "Simpan pilihan", saved: "Pilihan pemberitahuan disimpan.", denied: "Tindakan pemberitahuan tidak tersedia.", live: "Kemas kini disegerakkan secara automatik semasa halaman ini dibuka.",
  categories: { ACCOUNT: "Akaun", LEAD: "Prospek syarikat", APPROVAL: "Kelulusan", BUDGET: "Bajet", SOURCING: "Penyumberan", DELIVERY: "Penghantaran dan penerimaan", FINANCE: "Kewangan", EMAIL: "Penghantaran e-mel", WORKFLOW: "Permintaan" },
  eventLabels: eventLabels.ms,
};

const dictionaries = { en, ar, ms } as const;

export function notificationCentreMessages(locale: SupportedLocale) {
  return dictionaries[locale] ?? en;
}

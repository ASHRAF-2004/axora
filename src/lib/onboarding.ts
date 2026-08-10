import { z } from "zod";
import type { SessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { DEFAULT_LOCALE, isSupportedLocale, type SupportedLocale } from "./i18n";

export const TUTORIAL_STEP_STATUSES = [
  "NOT_STARTED",
  "VIEWED",
  "COMPLETED",
  "SKIPPED",
  "DISMISSED_TEMPORARILY",
] as const;
export type TutorialStepStatus = (typeof TUTORIAL_STEP_STATUSES)[number];

export interface TutorialStepDefinition {
  key: string;
  title: string;
  body: string;
  target: string;
  mobileTarget?: string;
}

const sharedHelp: TutorialStepDefinition = {
  key: "help-and-resume",
  title: "Return to guidance at any time",
  body: "Help keeps skipped steps available and lets you restart this role tutorial later.",
  target: "[data-tour='help']",
};

const definitions: Record<string, TutorialStepDefinition[]> = {
  PLATFORM_OWNER: [
    { key: "owner-dashboard", title: "Start with platform health", body: "Review company onboarding, workflow exceptions, and tenant-isolation alerts before opening detailed modules.", target: "[data-tour='dashboard']" },
    { key: "company-onboarding", title: "Create a complete company", body: "Add verified company information, billing context, branches, and a logo. Axora generates its accessible portal theme automatically.", target: "[data-tour='companies']" },
    { key: "global-operations", title: "Coordinate the global workflow", body: "Catalog, supplier, sourcing, delivery, and finance controls remain in Axora's operational scope.", target: "[data-tour='operations']" },
    { key: "audit-and-security", title: "Review evidence and security", body: "Use audit and system tools for investigations; elevated support actions remain recorded.", target: "[data-tour='audit']" },
    sharedHelp,
  ],
  PLATFORM_OPERATIONS: [
    { key: "operations-queue", title: "Work the exception queue", body: "Prioritize sourcing, preparation, delivery, and finance records that need Axora action.", target: "[data-tour='dashboard']" },
    { key: "sourcing", title: "Source without exposing suppliers", body: "Request quotations, compare complete terms, and record a selection rationale. Customer users do not see private supplier identities or buying cost.", target: "[data-tour='sourcing']" },
    { key: "delivery-coordination", title: "Coordinate fulfilment", body: "Assign delivery work and follow operational events without replacing customer receiving confirmation.", target: "[data-tour='deliveries']" },
    sharedHelp,
  ],
  COMPANY_ADMIN: [
    { key: "company-dashboard", title: "See what your company needs next", body: "The dashboard highlights pending approvals, branch budget pressure, delivery exceptions, and onboarding tasks.", target: "[data-tour='dashboard']" },
    { key: "branches-and-budgets", title: "Set branch responsibility", body: "Create branches, assign administrators and approvers, and set budgets before employees begin requesting.", target: "[data-tour='branches']" },
    { key: "people-and-access", title: "Invite people safely", body: "Choose role and scope, then send a one-time setup link. You never create or see another user's password.", target: "[data-tour='people']" },
    { key: "requests-and-approvals", title: "Keep requests and decisions separate", body: "Requesters submit needs; authorized approvers decide. Nobody approves their own request.", target: "[data-tour='requests']" },
    { key: "receiving", title: "Confirm delivery independently", body: "Drivers provide evidence, while your receiver records accepted, damaged, and missing quantities.", target: "[data-tour='deliveries']" },
    sharedHelp,
  ],
  BRANCH_ADMIN: [
    { key: "branch-dashboard", title: "Focus on your assigned branches", body: "Requests, budget, people, and delivery activity are limited to your active branch assignments.", target: "[data-tour='dashboard']" },
    { key: "branch-people", title: "Assign requesters and approvers", body: "Invite only roles allowed by your branch scope and keep at least one usable administrative path.", target: "[data-tour='people']" },
    { key: "branch-requests", title: "Monitor branch purchasing", body: "Follow requests, approvals, budget commitment, and exceptions without accessing other branches unless assigned.", target: "[data-tour='requests']" },
    sharedHelp,
  ],
  BRANCH_APPROVER: [
    { key: "approval-queue", title: "Your decision queue comes first", body: "Open only requests waiting for your assigned branch decision.", target: "[data-tour='approvals']" },
    { key: "approval-evidence", title: "Review context before deciding", body: "Check requester, items, needed date, budget effect, and supporting documents before approving or rejecting.", target: "[data-tour='approval-evidence']" },
    { key: "separation-of-duties", title: "Your own request needs another approver", body: "Axora blocks self-approval and records every decision and reason.", target: "[data-tour='approval-history']" },
    sharedHelp,
  ],
  COMPANY_APPROVER: [
    { key: "company-approval-queue", title: "Review company-wide decisions", body: "Your queue covers eligible branches in the company while preserving requester separation.", target: "[data-tour='approvals']" },
    { key: "company-budget-impact", title: "See the correct budget effect", body: "Compare the request total with its branch budget and existing approved commitments.", target: "[data-tour='budget-impact']" },
    { key: "decision-history", title: "Give clear reasons", body: "Rejections and exceptional decisions require useful context in the permanent workflow history.", target: "[data-tour='approval-history']" },
    sharedHelp,
  ],
  REQUESTER: [
    { key: "shop", title: "Start in Shop", body: "Find approved products by image, name, category, or search. Product quantities still follow catalog minimums.", target: "[data-tour='shop']", mobileTarget: "[data-mobile-tour='shop']" },
    { key: "cart", title: "Build one clear request", body: "Choose quantities, branch, needed date, urgency, and specifications before submitting.", target: "[data-tour='cart']" },
    { key: "request-status", title: "Follow the complete timeline", body: "The request page explains its current state, completed events, and the next responsible role.", target: "[data-tour='requests']" },
    { key: "request-actions", title: "Respond to requested changes", body: "Open required actions and delivery or invoice status that your permissions allow.", target: "[data-tour='required-actions']" },
    sharedHelp,
  ],
  FINANCE_REVIEWER: [
    { key: "finance-queue", title: "Start with finance exceptions", body: "Prioritize missing evidence, discrepancies, unmatched invoices, and COD status needing review.", target: "[data-tour='finance']" },
    { key: "three-way-match", title: "Compare three records", body: "Match the approved request or order, accepted receipt, and invoice before completing reconciliation.", target: "[data-tour='matching']" },
    { key: "cod-evidence", title: "Record COD status with evidence", body: "Use the approved payment method and keep receipt references and attachments attached to the correct invoice.", target: "[data-tour='payments']" },
    sharedHelp,
  ],
  AUDITOR: [
    { key: "audit-read-only", title: "Your workspace is read-only", body: "Filters, timelines, evidence, and exports are available without mutation actions.", target: "[data-tour='audit']" },
    { key: "audit-scope", title: "Evidence remains tenant scoped", body: "You see only the company and branch evidence included in your active assignment.", target: "[data-tour='audit-filters']" },
    sharedHelp,
  ],
  TECHNICAL_SUPPORT: [
    { key: "support-health", title: "Begin with diagnostics", body: "Review application health, account state, and safe support checks before taking action.", target: "[data-tour='system-health']" },
    { key: "support-boundary", title: "Commercial controls are separate", body: "Technical support cannot change company pricing, approve requests, source suppliers, or edit finance records.", target: "[data-tour='support-boundary']" },
    { key: "support-audit", title: "Elevated actions are visible", body: "Use only approved support actions and provide a reason for the audit record.", target: "[data-tour='support-actions']" },
    sharedHelp,
  ],
  DELIVERY_DRIVER: [
    { key: "today-deliveries", title: "Today's deliveries are first", body: "The next assigned stop shows the approved address, contact action, package summary, window, and instructions.", target: "[data-tour='driver-today']" },
    { key: "delivery-actions", title: "Record each real event", body: "Accept, start, arrive, deliver, or report an issue. Offline events stay queued until safely synchronized.", target: "[data-tour='driver-actions']" },
    { key: "delivery-evidence", title: "Evidence is not customer approval", body: "Upload permitted proof and receiver name, but the customer receiver confirms accepted quantities separately.", target: "[data-tour='driver-evidence']" },
    sharedHelp,
  ],
  RECEIVING_USER: [
    { key: "receipt-queue", title: "Confirm arrivals assigned to you", body: "Open a delivered job and compare packages with the requested quantities.", target: "[data-tour='receiving']" },
    { key: "inspect-quantity", title: "Separate accepted and discrepant quantity", body: "Record accepted, damaged, and missing amounts with notes and evidence when needed.", target: "[data-tour='receipt-lines']" },
    { key: "receipt-confirm", title: "Your confirmation is independent", body: "Driver evidence remains visible, but only your receiving action completes the customer inspection stage.", target: "[data-tour='receipt-confirm']" },
    sharedHelp,
  ],
};

type TutorialStepCopy = Pick<TutorialStepDefinition, "title" | "body">;

const localizedTutorialCopy: Record<Exclude<SupportedLocale, "en">, Record<string, TutorialStepCopy>> = {
  ar: {
    "help-and-resume": {
      title: "ارجع إلى الإرشادات في أي وقت",
      body: "تُبقي صفحة المساعدة الخطوات المتخطاة متاحة، وتتيح لك إعادة تشغيل دليل هذا الدور لاحقًا.",
    },
    "owner-dashboard": {
      title: "ابدأ بسلامة المنصة",
      body: "راجع تهيئة الشركات واستثناءات سير العمل وتنبيهات عزل الشركات قبل فتح الوحدات التفصيلية.",
    },
    "company-onboarding": {
      title: "أنشئ ملف شركة متكاملًا",
      body: "أضف معلومات الشركة الموثقة وبيانات الفوترة والفروع والشعار. تنشئ Axora مظهرًا متاحًا للبوابة تلقائيًا.",
    },
    "global-operations": {
      title: "نسّق سير العمل العام",
      body: "تظل إدارة الكتالوج والموردين والتوريد والتسليم والعمليات المالية ضمن نطاق عمليات Axora.",
    },
    "audit-and-security": {
      title: "راجع الأدلة والأمان",
      body: "استخدم سجل التدقيق وأدوات النظام للتحقيقات؛ وتبقى إجراءات الدعم ذات الصلاحيات المرتفعة مسجلة.",
    },
    "operations-queue": {
      title: "عالج قائمة الاستثناءات",
      body: "أعطِ الأولوية لسجلات التوريد والتجهيز والتسليم والعمليات المالية التي تتطلب إجراءً من Axora.",
    },
    sourcing: {
      title: "نفّذ التوريد مع حماية بيانات الموردين",
      body: "اطلب عروض الأسعار، وقارن الشروط كاملة، وسجّل مبررات الاختيار. لا يرى عملاء الشركات هويات الموردين الخاصة أو تكلفة الشراء.",
    },
    "delivery-coordination": {
      title: "نسّق التنفيذ والتسليم",
      body: "عيّن أعمال التسليم وتابع الأحداث التشغيلية من دون أن يحل ذلك محل تأكيد الاستلام من العميل.",
    },
    "company-dashboard": {
      title: "اطّلع على الخطوة التالية لشركتك",
      body: "تعرض لوحة المعلومات الموافقات المعلقة وضغط ميزانيات الفروع واستثناءات التسليم ومهام التهيئة.",
    },
    "branches-and-budgets": {
      title: "حدّد مسؤوليات الفروع",
      body: "أنشئ الفروع، وعيّن المديرين والموافقين، وحدّد الميزانيات قبل أن يبدأ الموظفون بتقديم الطلبات.",
    },
    "people-and-access": {
      title: "ادعُ المستخدمين بأمان",
      body: "اختر الدور والنطاق، ثم أرسل رابط إعداد لمرة واحدة. لن تنشئ كلمة مرور مستخدم آخر أو تراها.",
    },
    "requests-and-approvals": {
      title: "افصل بين الطلبات والقرارات",
      body: "يقدّم أصحاب الطلبات احتياجاتهم، ويتخذ الموافقون المخولون القرار. لا يمكن لأي شخص الموافقة على طلبه بنفسه.",
    },
    receiving: {
      title: "أكّد التسليم بصورة مستقلة",
      body: "يقدّم السائقون الأدلة، بينما يسجّل المستلم لديك الكميات المقبولة والتالفة والمفقودة.",
    },
    "branch-dashboard": {
      title: "ركّز على الفروع المعيّنة لك",
      body: "تقتصر الطلبات والميزانيات والمستخدمون وأنشطة التسليم على تعيينات فروعك النشطة.",
    },
    "branch-people": {
      title: "عيّن مقدّمي الطلبات والموافقين",
      body: "ادعُ فقط الأدوار المسموح بها ضمن نطاق فرعك، وحافظ على مسار إداري واحد صالح على الأقل.",
    },
    "branch-requests": {
      title: "تابع مشتريات الفرع",
      body: "تابع الطلبات والموافقات والتزامات الميزانية والاستثناءات من دون الوصول إلى فروع أخرى ما لم تكن معيّنًا لها.",
    },
    "approval-queue": {
      title: "ابدأ بقائمة القرارات المطلوبة منك",
      body: "افتح فقط الطلبات التي تنتظر قرارك ضمن الفرع المعيّن لك.",
    },
    "approval-evidence": {
      title: "راجع السياق قبل اتخاذ القرار",
      body: "تحقق من مقدم الطلب والأصناف والتاريخ المطلوب وأثر الميزانية والمستندات الداعمة قبل الموافقة أو الرفض.",
    },
    "separation-of-duties": {
      title: "يحتاج طلبك إلى موافق آخر",
      body: "تمنع Axora الموافقة الذاتية وتسجّل كل قرار وسببه.",
    },
    "company-approval-queue": {
      title: "راجع القرارات على مستوى الشركة",
      body: "تغطي قائمتك الفروع المؤهلة داخل الشركة مع الحفاظ على الفصل بين مقدم الطلب وصاحب القرار.",
    },
    "company-budget-impact": {
      title: "اطّلع على الأثر الصحيح في الميزانية",
      body: "قارن إجمالي الطلب بميزانية فرعه والالتزامات المعتمدة القائمة.",
    },
    "decision-history": {
      title: "قدّم أسبابًا واضحة",
      body: "تتطلب حالات الرفض والقرارات الاستثنائية سياقًا مفيدًا ضمن سجل سير العمل الدائم.",
    },
    shop: {
      title: "ابدأ من المتجر",
      body: "ابحث عن المنتجات المعتمدة بالصورة أو الاسم أو الفئة أو البحث. وتظل الكميات خاضعة للحدود الدنيا في الكتالوج.",
    },
    cart: {
      title: "أنشئ طلبًا واحدًا واضحًا",
      body: "حدّد الكميات والفرع والتاريخ المطلوب والأولوية والمواصفات قبل الإرسال.",
    },
    "request-status": {
      title: "تابع التسلسل الزمني الكامل",
      body: "توضح صفحة الطلب حالته الحالية والأحداث المكتملة والدور المسؤول عن الخطوة التالية.",
    },
    "request-actions": {
      title: "استجب للتعديلات المطلوبة",
      body: "افتح الإجراءات المطلوبة وحالة التسليم أو الفاتورة التي تسمح بها صلاحياتك.",
    },
    "finance-queue": {
      title: "ابدأ بالاستثناءات المالية",
      body: "أعطِ الأولوية للأدلة الناقصة والفروقات والفواتير غير المطابقة وحالات الدفع عند الاستلام التي تحتاج إلى مراجعة.",
    },
    "three-way-match": {
      title: "قارن السجلات الثلاثة",
      body: "طابق الطلب أو أمر الشراء المعتمد مع إيصال الاستلام المقبول والفاتورة قبل إكمال التسوية.",
    },
    "cod-evidence": {
      title: "سجّل حالة الدفع عند الاستلام مع الدليل",
      body: "استخدم طريقة الدفع المعتمدة، واربط مراجع الإيصالات والمرفقات بالفاتورة الصحيحة.",
    },
    "audit-read-only": {
      title: "مساحة عملك للقراءة فقط",
      body: "يمكنك استخدام المرشحات والتسلسلات الزمنية والأدلة وعمليات التصدير من دون إجراءات تعديل.",
    },
    "audit-scope": {
      title: "تظل الأدلة ضمن نطاق الشركة",
      body: "لا ترى سوى أدلة الشركة والفروع المشمولة في تعيينك النشط.",
    },
    "support-health": {
      title: "ابدأ بالتشخيص",
      body: "راجع سلامة التطبيق وحالة الحساب وفحوصات الدعم الآمنة قبل اتخاذ أي إجراء.",
    },
    "support-boundary": {
      title: "الضوابط التجارية منفصلة",
      body: "لا يمكن للدعم التقني تغيير أسعار الشركات أو الموافقة على الطلبات أو اختيار الموردين أو تعديل السجلات المالية.",
    },
    "support-audit": {
      title: "الإجراءات ذات الصلاحيات المرتفعة ظاهرة",
      body: "استخدم إجراءات الدعم المعتمدة فقط، وقدّم سببًا لإدراجه في سجل التدقيق.",
    },
    "supplier-queue": {
      title: "اطّلع فقط على الطلبات المعيّنة لك",
      body: "تحصل مؤسستك المورّدة على قائمة مركزة بأعمال عروض الأسعار والتنفيذ الخاصة بها.",
    },
    quotation: {
      title: "قدّم شروط عرض سعر متكاملة",
      body: "أضف السعر والحد الأدنى للطلب والمهلة والصلاحية والتوفر ورسوم التسليم والمستند المعتمد.",
    },
    "supplier-privacy": {
      title: "تبقى بيانات الموردين الآخرين خاصة",
      body: "لا يمكنك رؤية المنافسين أو عروضهم أو هامش Axora أو سجلات العملاء غير المرتبطة بك.",
    },
    "today-deliveries": {
      title: "ابدأ بتسليمات اليوم",
      body: "تعرض المحطة التالية المعيّنة العنوان المعتمد وخيار الاتصال وملخص الطرود والموعد والتعليمات.",
    },
    "delivery-actions": {
      title: "سجّل كل حدث فعلي",
      body: "اقبل المهمة أو ابدأ الرحلة أو سجّل الوصول أو التسليم أو المشكلة. تبقى الأحداث غير المتصلة في قائمة الانتظار حتى مزامنتها بأمان.",
    },
    "delivery-evidence": {
      title: "الدليل لا يُعد موافقة من العميل",
      body: "ارفع الإثبات المسموح واسم المستلم، لكن مستلم العميل يؤكد الكميات المقبولة بصورة مستقلة.",
    },
    "receipt-queue": {
      title: "أكّد الشحنات المعيّنة لك",
      body: "افتح مهمة تم تسليمها وقارن الطرود بالكميات المطلوبة.",
    },
    "inspect-quantity": {
      title: "افصل بين الكميات المقبولة والمختلفة",
      body: "سجّل الكميات المقبولة والتالفة والمفقودة مع الملاحظات والأدلة عند الحاجة.",
    },
    "receipt-confirm": {
      title: "تأكيدك مستقل",
      body: "يظل دليل السائق ظاهرًا، لكن إجراء الاستلام الذي تقوم به وحده يكمل مرحلة فحص العميل.",
    },
  },
  ms: {
    "help-and-resume": {
      title: "Kembali kepada panduan pada bila-bila masa",
      body: "Bantuan mengekalkan langkah yang dilangkau dan membolehkan anda memulakan semula tutorial peranan ini kemudian.",
    },
    "owner-dashboard": {
      title: "Mulakan dengan kesihatan platform",
      body: "Semak penyediaan syarikat, pengecualian aliran kerja dan amaran pengasingan penyewa sebelum membuka modul terperinci.",
    },
    "company-onboarding": {
      title: "Sediakan syarikat dengan lengkap",
      body: "Tambah maklumat syarikat yang disahkan, konteks pengebilan, cawangan dan logo. Axora menjana tema portal yang boleh dicapai secara automatik.",
    },
    "global-operations": {
      title: "Selaraskan aliran kerja menyeluruh",
      body: "Kawalan katalog, pembekal, penyumberan, penghantaran dan kewangan kekal dalam skop operasi Axora.",
    },
    "audit-and-security": {
      title: "Semak bukti dan keselamatan",
      body: "Gunakan audit dan alat sistem untuk siasatan; tindakan sokongan berkeistimewaan tinggi kekal direkodkan.",
    },
    "operations-queue": {
      title: "Urus baris gilir pengecualian",
      body: "Utamakan rekod penyumberan, penyediaan, penghantaran dan kewangan yang memerlukan tindakan Axora.",
    },
    sourcing: {
      title: "Buat penyumberan tanpa mendedahkan pembekal",
      body: "Minta sebut harga, bandingkan terma lengkap dan rekod alasan pemilihan. Pengguna syarikat pelanggan tidak melihat identiti pembekal persendirian atau kos belian.",
    },
    "delivery-coordination": {
      title: "Selaraskan pemenuhan",
      body: "Tetapkan tugasan penghantaran dan ikuti peristiwa operasi tanpa menggantikan pengesahan penerimaan pelanggan.",
    },
    "company-dashboard": {
      title: "Lihat tindakan seterusnya untuk syarikat anda",
      body: "Papan pemuka menyerlahkan kelulusan tertunda, tekanan bajet cawangan, pengecualian penghantaran dan tugasan penyediaan.",
    },
    "branches-and-budgets": {
      title: "Tetapkan tanggungjawab cawangan",
      body: "Cipta cawangan, tetapkan pentadbir dan pelulus, serta sediakan bajet sebelum pekerja mula membuat permintaan.",
    },
    "people-and-access": {
      title: "Jemput pengguna dengan selamat",
      body: "Pilih peranan dan skop, kemudian hantar pautan penyediaan sekali guna. Anda tidak pernah mencipta atau melihat kata laluan pengguna lain.",
    },
    "requests-and-approvals": {
      title: "Asingkan permintaan daripada keputusan",
      body: "Pemohon menyerahkan keperluan; pelulus yang diberi kuasa membuat keputusan. Tiada sesiapa boleh meluluskan permintaan sendiri.",
    },
    receiving: {
      title: "Sahkan penghantaran secara berasingan",
      body: "Pemandu memberikan bukti, manakala penerima anda merekodkan kuantiti diterima, rosak dan hilang.",
    },
    "branch-dashboard": {
      title: "Fokus pada cawangan yang ditetapkan kepada anda",
      body: "Permintaan, bajet, pengguna dan aktiviti penghantaran dihadkan kepada penetapan cawangan aktif anda.",
    },
    "branch-people": {
      title: "Tetapkan pemohon dan pelulus",
      body: "Jemput hanya peranan yang dibenarkan dalam skop cawangan anda dan kekalkan sekurang-kurangnya satu laluan pentadbiran yang boleh digunakan.",
    },
    "branch-requests": {
      title: "Pantau pembelian cawangan",
      body: "Ikuti permintaan, kelulusan, komitmen bajet dan pengecualian tanpa mengakses cawangan lain melainkan anda ditetapkan kepadanya.",
    },
    "approval-queue": {
      title: "Utamakan baris gilir keputusan anda",
      body: "Buka hanya permintaan yang menunggu keputusan anda untuk cawangan yang ditetapkan.",
    },
    "approval-evidence": {
      title: "Semak konteks sebelum membuat keputusan",
      body: "Semak pemohon, item, tarikh diperlukan, kesan bajet dan dokumen sokongan sebelum meluluskan atau menolak.",
    },
    "separation-of-duties": {
      title: "Permintaan anda memerlukan pelulus lain",
      body: "Axora menyekat kelulusan kendiri dan merekodkan setiap keputusan serta alasannya.",
    },
    "company-approval-queue": {
      title: "Semak keputusan seluruh syarikat",
      body: "Baris gilir anda merangkumi cawangan yang layak dalam syarikat sambil mengekalkan pengasingan pemohon.",
    },
    "company-budget-impact": {
      title: "Lihat kesan bajet yang tepat",
      body: "Bandingkan jumlah permintaan dengan bajet cawangannya dan komitmen diluluskan yang sedia ada.",
    },
    "decision-history": {
      title: "Berikan alasan yang jelas",
      body: "Penolakan dan keputusan luar biasa memerlukan konteks berguna dalam sejarah aliran kerja kekal.",
    },
    shop: {
      title: "Mulakan di Kedai",
      body: "Cari produk diluluskan melalui imej, nama, kategori atau carian. Kuantiti produk masih tertakluk pada minimum katalog.",
    },
    cart: {
      title: "Bina satu permintaan yang jelas",
      body: "Pilih kuantiti, cawangan, tarikh diperlukan, keutamaan dan spesifikasi sebelum menyerahkan.",
    },
    "request-status": {
      title: "Ikuti garis masa lengkap",
      body: "Halaman permintaan menerangkan keadaan semasa, peristiwa selesai dan peranan yang bertanggungjawab seterusnya.",
    },
    "request-actions": {
      title: "Beri respons kepada perubahan yang diminta",
      body: "Buka tindakan diperlukan serta status penghantaran atau invois yang dibenarkan oleh keizinan anda.",
    },
    "finance-queue": {
      title: "Mulakan dengan pengecualian kewangan",
      body: "Utamakan bukti yang tiada, percanggahan, invois tidak dipadankan dan status COD yang memerlukan semakan.",
    },
    "three-way-match": {
      title: "Bandingkan tiga rekod",
      body: "Padankan permintaan atau pesanan yang diluluskan, penerimaan yang disahkan dan invois sebelum melengkapkan rekonsiliasi.",
    },
    "cod-evidence": {
      title: "Rekod status COD berserta bukti",
      body: "Gunakan kaedah bayaran yang diluluskan dan pastikan rujukan resit serta lampiran dipautkan kepada invois yang betul.",
    },
    "audit-read-only": {
      title: "Ruang kerja anda ialah baca sahaja",
      body: "Penapis, garis masa, bukti dan eksport tersedia tanpa tindakan pengubahsuaian.",
    },
    "audit-scope": {
      title: "Bukti kekal dalam skop penyewa",
      body: "Anda hanya melihat bukti syarikat dan cawangan yang termasuk dalam penetapan aktif anda.",
    },
    "support-health": {
      title: "Mulakan dengan diagnostik",
      body: "Semak kesihatan aplikasi, keadaan akaun dan pemeriksaan sokongan yang selamat sebelum mengambil tindakan.",
    },
    "support-boundary": {
      title: "Kawalan komersial adalah berasingan",
      body: "Sokongan teknikal tidak boleh mengubah harga syarikat, meluluskan permintaan, memilih pembekal atau menyunting rekod kewangan.",
    },
    "support-audit": {
      title: "Tindakan berkeistimewaan tinggi dapat dilihat",
      body: "Gunakan hanya tindakan sokongan yang diluluskan dan berikan alasan untuk rekod audit.",
    },
    "supplier-queue": {
      title: "Lihat hanya permintaan yang ditetapkan kepada anda",
      body: "Organisasi pembekal anda menerima senarai kerja sebut harga dan pemenuhan yang khusus.",
    },
    quotation: {
      title: "Hantar terma sebut harga yang lengkap",
      body: "Tambah harga, MOQ, tempoh mendahului, tempoh sah, ketersediaan, caj penghantaran dan dokumen yang diluluskan.",
    },
    "supplier-privacy": {
      title: "Pembekal lain kekal sulit",
      body: "Anda tidak boleh melihat pesaing, sebut harga mereka, margin Axora atau rekod pelanggan yang tidak berkaitan.",
    },
    "today-deliveries": {
      title: "Utamakan penghantaran hari ini",
      body: "Hentian seterusnya yang ditetapkan menunjukkan alamat diluluskan, tindakan hubungan, ringkasan bungkusan, tempoh masa dan arahan.",
    },
    "delivery-actions": {
      title: "Rekod setiap peristiwa sebenar",
      body: "Terima, mulakan perjalanan, tiba, hantar atau laporkan isu. Peristiwa luar talian kekal dalam baris gilir sehingga disegerakkan dengan selamat.",
    },
    "delivery-evidence": {
      title: "Bukti bukan kelulusan pelanggan",
      body: "Muat naik bukti yang dibenarkan dan nama penerima, tetapi penerima pelanggan mengesahkan kuantiti diterima secara berasingan.",
    },
    "receipt-queue": {
      title: "Sahkan ketibaan yang ditetapkan kepada anda",
      body: "Buka tugasan yang telah dihantar dan bandingkan bungkusan dengan kuantiti diminta.",
    },
    "inspect-quantity": {
      title: "Asingkan kuantiti diterima dan kuantiti bercanggah",
      body: "Rekod jumlah diterima, rosak dan hilang berserta catatan dan bukti apabila diperlukan.",
    },
    "receipt-confirm": {
      title: "Pengesahan anda adalah berasingan",
      body: "Bukti pemandu kekal kelihatan, tetapi hanya tindakan penerimaan anda melengkapkan peringkat pemeriksaan pelanggan.",
    },
  },
};

const legacyRoleMap: Record<string, string> = {
  ADMIN: "COMPANY_ADMIN",
  APPROVER: "BRANCH_APPROVER",
  FINANCE: "FINANCE_REVIEWER",
  VIEWER: "AUDITOR",
  IT_SUPPORT: "TECHNICAL_SUPPORT",
  OPERATIONS: "REQUESTER",
};

export function tutorialForRole(
  roleKey: string,
  isOwner = false,
  locale: SupportedLocale = DEFAULT_LOCALE,
) {
  const canonical = isOwner ? "PLATFORM_OWNER" : legacyRoleMap[roleKey] ?? roleKey;
  const steps = definitions[canonical] ?? definitions.REQUESTER;
  const safeLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  if (safeLocale === DEFAULT_LOCALE) return steps;
  const copy = safeLocale === "ar" ? localizedTutorialCopy.ar : localizedTutorialCopy.ms;
  return steps.map((step) => ({ ...step, ...(copy[step.key] ?? {}) }));
}

const updateSchema = z.object({
  roleKey: z.string().trim().min(1).max(80),
  stepKey: z.string().trim().min(1).max(120),
  status: z.enum(TUTORIAL_STEP_STATUSES),
});

export async function listTutorialProgress(
  actor: SessionUser,
  roleKey = actor.role,
  locale: SupportedLocale = actor.preferredLocale ?? DEFAULT_LOCALE,
) {
  const steps = tutorialForRole(roleKey, actor.isOwner, locale);
  if (isDemoMode()) return steps.map((step) => ({ ...step, status: "NOT_STARTED" as TutorialStepStatus }));
  const result = await query<{ stepKey: string; status: TutorialStepStatus }>(`
    SELECT step_key AS "stepKey",status
    FROM tutorial_step_progress
    WHERE user_id=$1 AND role_key=$2
  `, [actor.id, roleKey]);
  const statusByKey = new Map(result.rows.map((row) => [row.stepKey, row.status]));
  return steps.map((step) => ({ ...step, status: statusByKey.get(step.key) ?? "NOT_STARTED" }));
}

export async function updateTutorialStep(
  input: { roleKey: string; stepKey: string; status: TutorialStepStatus },
  actor: SessionUser,
) {
  const safe = updateSchema.parse(input);
  const allowed = tutorialForRole(safe.roleKey, actor.isOwner).some((step) => step.key === safe.stepKey);
  if (!allowed) throw new Error("This tutorial step is not available for the current role.");
  if (isDemoMode()) return;
  await withAuditTransaction({ actor, reason: "Tutorial progress updated" }, (client) => client.query(`
    INSERT INTO tutorial_step_progress(
      user_id,role_key,step_key,status,first_viewed_at,completed_at,skipped_at,dismissed_at,updated_at
    ) VALUES (
      $1,$2,$3,$4,
      CASE WHEN $4 IN ('VIEWED','COMPLETED','SKIPPED','DISMISSED_TEMPORARILY') THEN now() ELSE NULL END,
      CASE WHEN $4='COMPLETED' THEN now() ELSE NULL END,
      CASE WHEN $4='SKIPPED' THEN now() ELSE NULL END,
      CASE WHEN $4='DISMISSED_TEMPORARILY' THEN now() ELSE NULL END,
      now()
    )
    ON CONFLICT(user_id,role_key,step_key) DO UPDATE SET
      status=EXCLUDED.status,
      first_viewed_at=COALESCE(tutorial_step_progress.first_viewed_at,EXCLUDED.first_viewed_at),
      completed_at=CASE WHEN EXCLUDED.status='COMPLETED' THEN now() ELSE tutorial_step_progress.completed_at END,
      skipped_at=CASE WHEN EXCLUDED.status='SKIPPED' THEN now() ELSE tutorial_step_progress.skipped_at END,
      dismissed_at=CASE WHEN EXCLUDED.status='DISMISSED_TEMPORARILY' THEN now() ELSE tutorial_step_progress.dismissed_at END,
      updated_at=now()
  `, [actor.id, safe.roleKey, safe.stepKey, safe.status]));
}

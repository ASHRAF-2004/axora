export const SUPPORTED_LOCALES = ["en", "ar", "ms"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "en";
export const LOCALE_COOKIE = "axora_locale";

export const LOCALE_NAMES: Record<SupportedLocale, { native: string; english: string; dir: "ltr" | "rtl" }> = {
  en: { native: "English", english: "English", dir: "ltr" },
  ar: { native: "العربية", english: "Arabic", dir: "rtl" },
  ms: { native: "Bahasa Melayu", english: "Malay", dir: "ltr" },
};

export function isSupportedLocale(value: string | undefined | null): value is SupportedLocale {
  return Boolean(value && (SUPPORTED_LOCALES as readonly string[]).includes(value));
}

export function persistBrowserLocale(
  locale: SupportedLocale,
  browser: {
    documentElement: { lang: string; dir: string };
    protocol: string;
    writeCookie: (value: string) => void;
  } = {
    documentElement: document.documentElement,
    protocol: window.location.protocol,
    writeCookie: (value) => { document.cookie = value; },
  },
) {
  browser.documentElement.lang = locale;
  browser.documentElement.dir = LOCALE_NAMES[locale].dir;
  browser.writeCookie(
    `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${browser.protocol === "https:" ? "; Secure" : ""}`,
  );
}

export function nearestSupportedLocale(languageTags: readonly string[]): SupportedLocale {
  for (const languageTag of languageTags) {
    const normalized = languageTag.trim().toLowerCase().replace("_", "-");
    const base = normalized.split("-")[0];
    if (isSupportedLocale(normalized)) return normalized;
    if (isSupportedLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export function parseAcceptLanguage(value: string | null | undefined) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => {
      const [tag, ...parameters] = entry.trim().split(";");
      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => /^q=/i.test(parameter));
      return { tag, quality: quality ? Number(quality.slice(2)) : 1 };
    })
    .filter((entry) => entry.tag && Number.isFinite(entry.quality) && entry.quality > 0 && entry.quality <= 1)
    .sort((first, second) => second.quality - first.quality)
    .map((entry) => entry.tag);
}

export const PUBLIC_PAGE_SLUGS = [
  "how-it-works",
  "procurement-process",
  "solutions-by-role",
  "company-procurement",
  "supplier-collaboration",
  "delivery-tracking",
  "security-and-privacy",
  "about",
  "help",
  "privacy",
  "terms",
] as const;
export type PublicPageSlug = (typeof PUBLIC_PAGE_SLUGS)[number];

interface PublicSection {
  title: string;
  body: string;
  points?: string[];
}

interface PublicPageContent {
  eyebrow: string;
  title: string;
  intro: string;
  sections: PublicSection[];
}

interface PublicMessages {
  skipToContent: string;
  nav: {
    home: string;
    how: string;
    process: string;
    roles: string;
    security: string;
    about: string;
    contact: string;
    login: string;
    menu: string;
    primaryNavigation: string;
    mobileNavigation: string;
  };
  language: {
    label: string;
    detectedTitle: string;
    detectedBody: string;
    continue: string;
    choose: string;
    close: string;
  };
  home: {
    eyebrow: string;
    title: string;
    lead: string;
    primaryAction: string;
    secondaryAction: string;
    trustNote: string;
    heroVisualLabel: string;
    requestLabel: string;
    requestBody: string;
    approveLabel: string;
    approveBody: string;
    deliverLabel: string;
    deliverBody: string;
    traceableLabel: string;
    processEyebrow: string;
    rolesEyebrow: string;
    trackingEyebrow: string;
    securityEyebrow: string;
    contactEyebrow: string;
    processTitle: string;
    processLead: string;
    stages: Array<{ title: string; body: string }>;
    rolesTitle: string;
    rolesLead: string;
    roles: Array<{ title: string; body: string; href: string }>;
    trackingTitle: string;
    trackingBody: string;
    securityTitle: string;
    securityBody: string;
    closingTitle: string;
    closingBody: string;
  };
  contact: {
    eyebrow: string;
    title: string;
    intro: string;
    name: string;
    email: string;
    company: string;
    phone: string;
    subject: string;
    message: string;
    privacy: string;
    submit: string;
    sending: string;
    success: string;
    failure: string;
    unavailable: string;
    securityNote: string;
    validationNote: string;
  };
  footer: {
    summary: string;
    product: string;
    company: string;
    legal: string;
    help: string;
    privacy: string;
    terms: string;
    rights: string;
  };
  pages: Record<PublicPageSlug, PublicPageContent>;
}

const englishPages: Record<PublicPageSlug, PublicPageContent> = {
  "how-it-works": {
    eyebrow: "How Axora works",
    title: "One accountable path from a business need to a complete record.",
    intro: "Axora gives each participant a focused workspace while maintaining a shared, auditable procurement lifecycle.",
    sections: [
      { title: "Employees request", body: "Authorized employees choose catalog items, quantities, branch, required date, and supporting context. They see only their permitted company and branch data." },
      { title: "Companies decide", body: "The correct approver reviews the request, budget effect, supporting files, and history. A requester cannot approve their own request." },
      { title: "Axora coordinates", body: "Axora manages private supplier sourcing, quotation comparison, order coordination, delivery administration, and finance evidence without exposing internal buying cost to customer users." },
      { title: "Delivery is independently received", body: "A driver records operational evidence. An authorized company receiver separately confirms quantities, damage, missing items, and discrepancies." },
    ],
  },
  "procurement-process": {
    eyebrow: "Procurement process",
    title: "Every stage has an owner, status, and evidence trail.",
    intro: "The Axora lifecycle follows practical procurement controls without forcing nontechnical teams to learn complex ERP terminology.",
    sections: [
      { title: "1. Identify and request", body: "A branch identifies a need and creates a purchase request from the approved catalog or with a clear ad-hoc specification." },
      { title: "2. Review and approve", body: "Company approvers check necessity, budget, scope, required date, and supporting evidence. The decision and reason become part of the timeline." },
      { title: "3. Source and coordinate", body: "Axora requests quotations from eligible suppliers, evaluates commercial and delivery terms, records the selection rationale, and coordinates the order." },
      { title: "4. Deliver and receive", body: "The delivery team reports preparation, travel, arrival, completion, or issues. Customer receiving remains a separate confirmation." },
      { title: "5. Match and close", body: "The approved request, accepted receipt, and invoice are compared. Mismatches remain visible until resolved; COD status and completion are recorded." },
    ],
  },
  "solutions-by-role": {
    eyebrow: "Solutions by role",
    title: "Each person sees the next work that belongs to them.",
    intro: "Axora avoids one crowded dashboard for every role. Permissions, tenant, branch assignment, and workflow state shape each experience.",
    sections: [
      { title: "Requesters and approvers", body: "Requesters shop and track their work. Approvers receive a decision queue with budget and evidence context, while separation of duties prevents self-approval." },
      { title: "Company and branch administrators", body: "Administrators manage permitted people, branch scopes, budgets, approvals, delivery status, and company-visible reporting." },
      { title: "Finance and auditors", body: "Finance reviewers handle invoices, COD evidence, matching, and exceptions. Auditors receive read-only evidence and immutable event history." },
      { title: "Suppliers, drivers, and receivers", body: "Simple dedicated portals expose only assigned quotations, deliveries, or receiving tasks and the minimum data required to complete them." },
    ],
  },
  "company-procurement": {
    eyebrow: "Company procurement",
    title: "Control branch purchasing without losing everyday simplicity.",
    intro: "Customer companies manage their own people, branches, budgets, requests, approvals, receiving, and permitted finance records.",
    sections: [
      { title: "Clear company boundaries", body: "Company users cannot see another tenant, private supplier records, Axora buying cost, or internal commercial notes." },
      { title: "Branch-aware budgets", body: "Requests are attached to a branch and approved commitments are reflected against the correct monthly budget period." },
      { title: "Useful status, not mystery", body: "Plain-language timelines explain what happened, who owns the next action, and why an item is blocked or delayed." },
    ],
  },
  "supplier-collaboration": {
    eyebrow: "Supplier collaboration",
    title: "A focused quotation and fulfilment workspace for each supplier.",
    intro: "Supplier users receive only work assigned to their supplier organization and never see competing suppliers or confidential internal selection data.",
    sections: [
      { title: "Respond with complete terms", body: "Submit price, minimum order quantity, lead time, validity, availability, delivery charge, and quotation documents in one clear mobile form." },
      { title: "Follow shared commitments", body: "Acknowledge selected work, keep a response and clarification history, upload supporting documents, and view Axora-registered invoice and COD status." },
      { title: "Commercial privacy", body: "Competitor quotations, Axora margin, unrelated customers, and private selection notes remain unavailable." },
    ],
  },
  "delivery-tracking": {
    eyebrow: "Delivery tracking",
    title: "Simple field updates, reliable evidence, independent receiving.",
    intro: "Drivers get a mobile-first list of assigned work with clear actions and minimal customer information.",
    sections: [
      { title: "The next delivery is obvious", body: "Branch, approved address, contact action, package summary, availability window, and special instructions are prioritized." },
      { title: "Status updates survive weak networks", body: "Idempotent delivery status events can queue on the driver’s device and synchronize later. Evidence files upload only while online and show clear retry feedback." },
      { title: "Evidence is not approval", body: "Driver photos, delivery notes, handover names, and reported quantities remain distinct from the customer receiver’s quantity and inspection confirmation." },
    ],
  },
  "security-and-privacy": {
    eyebrow: "Security and privacy",
    title: "Procurement access is scoped by role, tenant, branch, and assignment.",
    intro: "Axora is designed around least privilege, server-side authorization, secure account invitations, auditable transitions, and controlled file visibility.",
    sections: [
      { title: "Account security", body: "New users create their own passwords through expiring, single-use invitations. Passwords are hashed, sessions can be revoked, and authentication errors avoid account enumeration." },
      { title: "Tenant and commercial separation", body: "Customer users are restricted to their company and approved branch scope. Supplier identities, buying cost, private documents, and internal notes remain protected." },
      { title: "Evidence and recovery", body: "Important actions produce audit and workflow records. Production data and persistent files follow verified backup, restore, and rollback procedures." },
      { title: "Responsible disclosure", body: "Do not send passwords, invitation links, payment evidence, or confidential procurement data through the public contact form." },
    ],
  },
  about: {
    eyebrow: "About Axora",
    title: "Procurement coordination built for accountable business operations.",
    intro: "Axora connects company requesters and approvers with Axora operations, suppliers, delivery teams, receivers, and finance evidence in one coherent workflow.",
    sections: [
      { title: "Product purpose", body: "The platform reduces fragmented spreadsheets, messages, and status chasing while preserving clear responsibility at every step." },
      { title: "What Axora does not claim", body: "This website does not present unsupported customer numbers, certifications, partnerships, savings guarantees, or service commitments." },
    ],
  },
  help: {
    eyebrow: "Help and FAQ",
    title: "Straight answers for common Axora tasks.",
    intro: "Signed-in users also receive role-specific guidance and can resume individual onboarding steps from Help.",
    sections: [
      { title: "How do I get an account?", body: "An authorized Axora or company administrator sends a private invitation. You open the one-time link and create your own password." },
      { title: "Why can’t I see a module?", body: "Navigation follows your role, tenant, branch assignment, and current permissions. Hidden access is also enforced on the server." },
      { title: "Can a requester approve the same request?", body: "No. Axora preserves separation of duties and prevents self-approval." },
      { title: "What should I do with a delivery problem?", body: "The driver records operational evidence and the receiver records accepted, damaged, or missing quantities. The discrepancy remains open until resolved." },
    ],
  },
  privacy: {
    eyebrow: "Privacy notice",
    title: "How Axora handles account and procurement information.",
    intro: "This product notice describes the intended handling of Axora platform data. Final legal wording, retention periods, and controller details require owner and legal review before production publication.",
    sections: [
      { title: "Information used", body: "Axora processes account, company, branch, request, quotation, delivery, receiving, invoice, support, security, and audit information required to operate the service. The public visitor counter uses the public IP address observed by the server to derive and retain a permanent secret-keyed hash; it does not store the raw IP address. People sharing one public IP share one visitor spot." },
      { title: "Access and purpose", body: "Data is used for authenticated procurement workflows, security, support, operational communication, evidence, and recovery. Access is restricted by role and scope." },
      { title: "Public forms", body: "Contact submissions are validated, rate limited, spam checked, retained for follow-up, and must not include passwords or confidential procurement data." },
      { title: "Questions and rights", body: "Use Contact Us for privacy questions. Verified account requests are handled according to applicable obligations and the final approved policy." },
    ],
  },
  terms: {
    eyebrow: "Terms of use",
    title: "Rules for authorized use of Axora.",
    intro: "These product terms are a review draft and are not a substitute for owner-approved legal terms before production publication.",
    sections: [
      { title: "Authorized access", body: "Users must use only their own account, protect invitation and session links, and access only work permitted by their role and organization." },
      { title: "Accurate records", body: "Users should provide accurate request, quotation, delivery, receiving, invoice, and contact information and correct discovered errors promptly." },
      { title: "Prohibited use", body: "Do not bypass access controls, upload malicious or unlawful content, impersonate another person, expose confidential records, or interfere with platform operation." },
      { title: "Operational status", body: "Service scope, support arrangements, retention, liability, and governing law require final written business and legal approval." },
    ],
  },
};

const arabicPages: Record<PublicPageSlug, PublicPageContent> = {
  "how-it-works": {
    eyebrow: "كيف تعمل أكسورا",
    title: "مسار واحد بمسؤوليات واضحة من احتياج العمل إلى سجل مكتمل.",
    intro: "تمنح أكسورا كل مشارك مساحة عمل مركزة، وتحافظ في الوقت نفسه على دورة مشتريات مشتركة وقابلة للتدقيق.",
    sections: [
      { title: "الموظفون يطلبون", body: "يختار الموظفون المخوّلون أصناف الكتالوج والكميات والفرع والموعد المطلوب والمعلومات الداعمة. ولا يرون إلا بيانات الشركة والفروع المسموح بها." },
      { title: "الشركات تقرر", body: "يراجع المعتمد الصحيح الطلب وتأثيره في الميزانية والملفات والسجل. ولا يمكن لمقدم الطلب اعتماد طلبه بنفسه." },
      { title: "أكسورا تنسق", body: "تدير أكسورا التوريد الخاص ومقارنة العروض وتنسيق الطلب والتسليم والسجلات المالية، من دون إظهار تكلفة الشراء الداخلية لمستخدمي الشركة." },
      { title: "الاستلام مستقل عن التسليم", body: "يسجل السائق دليل التسليم، ثم يؤكد مستلم مخوّل من الشركة الكميات والتلف والنواقص والفروقات بصورة مستقلة." },
    ],
  },
  "procurement-process": {
    eyebrow: "عملية المشتريات",
    title: "لكل مرحلة مسؤول وحالة وسجل أدلة.",
    intro: "تتبع دورة أكسورا ضوابط مشتريات عملية بلغة واضحة لغير المتخصصين.",
    sections: [
      { title: "1. تحديد الاحتياج وإنشاء الطلب", body: "يحدد الفرع احتياجه وينشئ طلب شراء من الكتالوج المعتمد أو بمواصفات واضحة للطلب الخاص." },
      { title: "2. المراجعة والاعتماد", body: "يراجع معتمدو الشركة الحاجة والميزانية والنطاق والموعد والمستندات. ويصبح القرار وسببه جزءًا من الخط الزمني." },
      { title: "3. التوريد والتنسيق", body: "تطلب أكسورا عروضًا من الموردين المؤهلين وتقارن الشروط التجارية ومواعيد التسليم وتسجل سبب الاختيار وتنسق الطلب." },
      { title: "4. التسليم والاستلام", body: "يسجل فريق التسليم التجهيز والانطلاق والوصول والإنجاز أو المشكلة، بينما يبقى استلام العميل تأكيدًا منفصلًا." },
      { title: "5. المطابقة والإغلاق", body: "تتم مقارنة الطلب المعتمد والاستلام المقبول والفاتورة. وتبقى الفروقات ظاهرة حتى حلها، مع تسجيل حالة الدفع عند الاستلام والإكمال." },
    ],
  },
  "solutions-by-role": {
    eyebrow: "الحلول حسب الدور",
    title: "يرى كل شخص العمل التالي الذي يخصه.",
    intro: "لا تفرض أكسورا لوحة مزدحمة على الجميع؛ إذ تحدد الصلاحية والشركة والفرع وحالة سير العمل التجربة المناسبة.",
    sections: [
      { title: "مقدمو الطلبات والمعتمدون", body: "يتسوق مقدم الطلب ويتابع عمله، بينما يستلم المعتمد قائمة قرارات تتضمن الميزانية والأدلة، مع منع الاعتماد الذاتي." },
      { title: "مديرو الشركات والفروع", body: "يدير المديرون الأشخاص والفروع والميزانيات والاعتمادات وحالة التسليم والتقارير ضمن نطاقهم." },
      { title: "المالية والمدققون", body: "يراجع فريق المالية الفواتير وإثبات الدفع والمطابقة والاستثناءات، ويحصل المدقق على أدلة وسجل أحداث للقراءة فقط." },
      { title: "الموردون والسائقون والمستلمون", body: "تعرض البوابات المبسطة عروض الأسعار أو عمليات التسليم أو مهام الاستلام المسندة فقط وبأقل قدر لازم من البيانات." },
    ],
  },
  "company-procurement": {
    eyebrow: "مشتريات الشركات",
    title: "تحكم في مشتريات الفروع مع الحفاظ على سهولة العمل اليومي.",
    intro: "تدير الشركات موظفيها وفروعها وميزانياتها وطلباتها واعتماداتها واستلامها والسجلات المالية المسموح بها.",
    sections: [
      { title: "حدود واضحة لكل شركة", body: "لا يستطيع مستخدم الشركة رؤية شركة أخرى أو سجلات الموردين الخاصة أو تكلفة شراء أكسورا أو الملاحظات التجارية الداخلية." },
      { title: "ميزانيات مرتبطة بالفروع", body: "يرتبط كل طلب بفرع، وتنعكس الالتزامات المعتمدة على ميزانية الفرع والفترة الشهرية الصحيحة." },
      { title: "حالة مفهومة وليست غامضة", body: "توضح الخطوط الزمنية بلغة سهلة ما حدث ومن يملك الإجراء التالي ولماذا تعطل الطلب أو تأخر." },
    ],
  },
  "supplier-collaboration": {
    eyebrow: "تعاون الموردين",
    title: "مساحة مركزة لعروض الأسعار والتنفيذ لكل مورد.",
    intro: "لا يرى مستخدم المورد إلا العمل المسند إلى مؤسسته، ولا يرى الموردين المنافسين أو بيانات الاختيار الداخلية السرية.",
    sections: [
      { title: "عرض كامل الشروط", body: "أدخل السعر والحد الأدنى للطلب ومدة التجهيز والصلاحية والتوفر ورسوم التسليم ومستند العرض في نموذج جوال واضح." },
      { title: "متابعة الالتزامات", body: "أكد العمل المختار واحتفظ بسجل الردود والاستيضاحات وارفع المستندات المساندة وتابع الفاتورة وحالة الدفع عند الاستلام بعد تسجيلها لدى أكسورا." },
      { title: "خصوصية تجارية", body: "تبقى عروض المنافسين وهامش أكسورا والعملاء غير المرتبطين وملاحظات الاختيار الخاصة غير متاحة." },
    ],
  },
  "delivery-tracking": {
    eyebrow: "تتبع التسليم",
    title: "تحديثات ميدانية بسيطة وأدلة موثوقة واستلام مستقل.",
    intro: "يحصل السائق على قائمة جوال للمهام المسندة، بإجراءات واضحة وأقل قدر لازم من بيانات العميل.",
    sections: [
      { title: "التسليم التالي واضح", body: "يظهر الفرع والعنوان المعتمد وخيار الاتصال وملخص الطرود ووقت التوفر والتعليمات الخاصة في المقدمة." },
      { title: "تحديثات الحالة تتحمل ضعف الشبكة", body: "يمكن حفظ أحداث حالة التسليم ذات المعرّف الفريد على جهاز السائق ومزامنتها لاحقًا. ترفع ملفات الدليل عند توفر الاتصال مع إظهار حالة إعادة المحاولة بوضوح." },
      { title: "الدليل ليس اعتمادًا", body: "تبقى صور السائق وسندات التسليم وأسماء التسليم والكميات التي أبلغ عنها منفصلة عن تأكيد الكميات والفحص الذي يسجله مستلم الشركة." },
    ],
  },
  "security-and-privacy": {
    eyebrow: "الأمان والخصوصية",
    title: "يتحدد الوصول حسب الدور والشركة والفرع والتكليف.",
    intro: "صُممت أكسورا على أساس الحد الأدنى من الصلاحيات والتحقق في الخادم والدعوات الآمنة والتحولات القابلة للتدقيق ورؤية الملفات المنضبطة.",
    sections: [
      { title: "أمان الحساب", body: "ينشئ المستخدم الجديد كلمة مروره عبر دعوة قصيرة الصلاحية ومرة واحدة. تُجزّأ كلمات المرور ويمكن إلغاء الجلسات ولا تكشف أخطاء الدخول وجود الحساب." },
      { title: "عزل الشركات والبيانات التجارية", body: "يقتصر مستخدم العميل على شركته وفروعه المعتمدة، وتبقى هوية الموردين وتكلفة الشراء والمستندات الخاصة والملاحظات الداخلية محمية." },
      { title: "الأدلة والتعافي", body: "تنتج الإجراءات المهمة سجلات تدقيق وسير عمل. وتتبع بيانات الإنتاج وملفاته إجراءات نسخ احتياطي واستعادة وتراجع تم التحقق منها." },
      { title: "الإبلاغ المسؤول", body: "لا ترسل كلمات مرور أو روابط دعوة أو إثباتات دفع أو بيانات مشتريات سرية عبر نموذج التواصل العام." },
    ],
  },
  about: {
    eyebrow: "عن أكسورا",
    title: "تنسيق مشتريات مبني لعمليات أعمال قابلة للمساءلة.",
    intro: "تربط أكسورا مقدمي الطلبات والمعتمدين بعمليات أكسورا والموردين وفرق التسليم والمستلمين والسجلات المالية ضمن مسار واحد.",
    sections: [
      { title: "هدف المنتج", body: "تقلل المنصة تشتت الجداول والرسائل وملاحقة الحالات، وتحافظ على مسؤولية واضحة في كل مرحلة." },
      { title: "ما لا تدعيه أكسورا", body: "لا يعرض هذا الموقع أعداد عملاء أو شهادات أو شراكات أو وفورات مضمونة أو التزامات خدمة غير موثقة." },
    ],
  },
  help: {
    eyebrow: "المساعدة والأسئلة الشائعة",
    title: "إجابات واضحة لمهام أكسورا الشائعة.",
    intro: "يحصل المستخدم المسجل أيضًا على إرشاد حسب دوره ويمكنه استئناف خطوات التهيئة الفردية من المساعدة.",
    sections: [
      { title: "كيف أحصل على حساب؟", body: "يرسل مسؤول مخوّل من أكسورا أو الشركة دعوة خاصة. تفتح الرابط لمرة واحدة وتنشئ كلمة مرورك بنفسك." },
      { title: "لماذا لا أرى وحدة معينة؟", body: "يتبع التنقل دورك وشركتك وفروعك وصلاحياتك الحالية، كما يفرض الخادم القيود نفسها." },
      { title: "هل يستطيع مقدم الطلب اعتماد طلبه؟", body: "لا. تحافظ أكسورا على فصل المسؤوليات وتمنع الاعتماد الذاتي." },
      { title: "ماذا أفعل عند وجود مشكلة تسليم؟", body: "يسجل السائق الدليل التشغيلي ويسجل المستلم الكميات المقبولة أو التالفة أو الناقصة، وتبقى المشكلة مفتوحة حتى حلها." },
    ],
  },
  privacy: {
    eyebrow: "إشعار الخصوصية",
    title: "كيف تتعامل أكسورا مع بيانات الحساب والمشتريات.",
    intro: "يصف هذا الإشعار طريقة التعامل المقصودة مع بيانات المنصة. تتطلب الصياغة القانونية النهائية وفترات الاحتفاظ وتفاصيل الجهة المسؤولة مراجعة المالك والمستشار القانوني قبل النشر.",
    sections: [
      { title: "المعلومات المستخدمة", body: "تعالج أكسورا بيانات الحساب والشركة والفرع والطلبات والعروض والتسليم والاستلام والفواتير والدعم والأمان والتدقيق اللازمة لتشغيل الخدمة. يستخدم عداد الزوار العام عنوان IP العام الذي يراه الخادم لاشتقاق بصمة دائمة مشفرة بمفتاح والاحتفاظ بها، ولا يخزن عنوان IP الخام. يشترك الأشخاص الذين يستخدمون عنوان IP عامًا واحدًا في مكان زائر واحد." },
      { title: "الوصول والغرض", body: "تستخدم البيانات لسير المشتريات الموثق والأمان والدعم والتواصل التشغيلي والأدلة والتعافي، ويقتصر الوصول حسب الدور والنطاق." },
      { title: "النماذج العامة", body: "يتم التحقق من طلبات التواصل وتحديد معدلها وفحص الرسائل المزعجة والاحتفاظ بها للمتابعة، ويجب ألا تتضمن كلمات مرور أو بيانات مشتريات سرية." },
      { title: "الأسئلة والحقوق", body: "استخدم تواصل معنا لأسئلة الخصوصية. تعالج طلبات الحساب التي تم التحقق منها وفق الالتزامات المعمول بها والسياسة النهائية المعتمدة." },
    ],
  },
  terms: {
    eyebrow: "شروط الاستخدام",
    title: "قواعد الاستخدام المخوّل لأكسورا.",
    intro: "هذه شروط منتج للمراجعة، ولا تحل محل الشروط القانونية التي يعتمدها المالك قبل النشر في الإنتاج.",
    sections: [
      { title: "الوصول المخوّل", body: "يجب على المستخدم استعمال حسابه فقط وحماية روابط الدعوة والجلسة والوصول إلى العمل المسموح به لدوره ومؤسسته." },
      { title: "دقة السجلات", body: "ينبغي تقديم معلومات دقيقة للطلبات والعروض والتسليم والاستلام والفواتير والتواصل وتصحيح الأخطاء المكتشفة سريعًا." },
      { title: "الاستخدام المحظور", body: "يُمنع تجاوز ضوابط الوصول أو رفع محتوى ضار أو غير قانوني أو انتحال شخصية أو كشف سجلات سرية أو تعطيل تشغيل المنصة." },
      { title: "الحالة التشغيلية", body: "يتطلب نطاق الخدمة والدعم والاحتفاظ والمسؤولية والقانون الحاكم موافقة تجارية وقانونية كتابية نهائية." },
    ],
  },
};

const malayPages: Record<PublicPageSlug, PublicPageContent> = {
  "how-it-works": {
    eyebrow: "Cara Axora berfungsi",
    title: "Satu laluan bertanggungjawab daripada keperluan perniagaan kepada rekod lengkap.",
    intro: "Axora memberi setiap peserta ruang kerja fokus sambil mengekalkan kitaran perolehan bersama yang boleh diaudit.",
    sections: [
      { title: "Pekerja membuat permintaan", body: "Pekerja yang diberi kuasa memilih item katalog, kuantiti, cawangan, tarikh diperlukan dan konteks sokongan. Mereka hanya melihat data syarikat dan cawangan yang dibenarkan." },
      { title: "Syarikat membuat keputusan", body: "Pelulus yang betul menyemak permintaan, kesan bajet, fail sokongan dan sejarah. Pemohon tidak boleh meluluskan permintaannya sendiri." },
      { title: "Axora menyelaras", body: "Axora mengurus sumber pembekal secara sulit, perbandingan sebut harga, pesanan, penghantaran dan bukti kewangan tanpa mendedahkan kos belian dalaman kepada pelanggan." },
      { title: "Penerimaan disahkan secara berasingan", body: "Pemandu merekod bukti operasi. Penerima syarikat yang diberi kuasa mengesahkan kuantiti, kerosakan, kekurangan dan perbezaan secara berasingan." },
    ],
  },
  "procurement-process": {
    eyebrow: "Proses perolehan",
    title: "Setiap peringkat mempunyai pemilik, status dan jejak bukti.",
    intro: "Kitaran Axora mengikut kawalan perolehan praktikal dengan bahasa mudah untuk pasukan bukan teknikal.",
    sections: [
      { title: "1. Kenal pasti dan mohon", body: "Cawangan mengenal pasti keperluan dan membuat permintaan daripada katalog diluluskan atau spesifikasi ad hoc yang jelas." },
      { title: "2. Semak dan lulus", body: "Pelulus syarikat menyemak keperluan, bajet, skop, tarikh dan bukti. Keputusan serta sebab menjadi sebahagian garis masa." },
      { title: "3. Sumber dan selaras", body: "Axora meminta sebut harga daripada pembekal layak, menilai terma komersial dan penghantaran, merekod alasan pemilihan dan menyelaras pesanan." },
      { title: "4. Hantar dan terima", body: "Pasukan penghantaran melapor persediaan, perjalanan, ketibaan, selesai atau isu. Pengesahan penerima pelanggan kekal berasingan." },
      { title: "5. Padankan dan tutup", body: "Permintaan diluluskan, penerimaan dan invois dibandingkan. Perbezaan kekal kelihatan sehingga selesai; status COD dan penutupan direkod." },
    ],
  },
  "solutions-by-role": {
    eyebrow: "Penyelesaian mengikut peranan",
    title: "Setiap orang melihat kerja seterusnya yang menjadi tanggungjawabnya.",
    intro: "Axora tidak memaksa satu papan pemuka sesak untuk semua. Peranan, penyewa, cawangan dan keadaan aliran kerja membentuk pengalaman.",
    sections: [
      { title: "Pemohon dan pelulus", body: "Pemohon membeli dan menjejak kerja sendiri. Pelulus menerima barisan keputusan dengan konteks bajet dan bukti; pengasingan tugas menghalang kelulusan sendiri." },
      { title: "Pentadbir syarikat dan cawangan", body: "Pentadbir mengurus orang, skop cawangan, bajet, kelulusan, status penghantaran dan laporan yang dibenarkan." },
      { title: "Kewangan dan juruaudit", body: "Penyemak kewangan mengurus invois, bukti COD, padanan dan pengecualian. Juruaudit mendapat bukti baca sahaja dan sejarah peristiwa kekal." },
      { title: "Pembekal, pemandu dan penerima", body: "Portal khas yang ringkas hanya mendedahkan sebut harga, penghantaran atau tugas penerimaan yang diberikan serta data minimum yang diperlukan." },
    ],
  },
  "company-procurement": {
    eyebrow: "Perolehan syarikat",
    title: "Kawal pembelian cawangan tanpa menjejaskan kesederhanaan harian.",
    intro: "Syarikat pelanggan mengurus orang, cawangan, bajet, permintaan, kelulusan, penerimaan dan rekod kewangan yang dibenarkan.",
    sections: [
      { title: "Sempadan syarikat yang jelas", body: "Pengguna syarikat tidak boleh melihat penyewa lain, rekod pembekal sulit, kos belian Axora atau nota komersial dalaman." },
      { title: "Bajet mengikut cawangan", body: "Permintaan diikat kepada cawangan dan komitmen diluluskan dikira pada tempoh bajet bulanan yang betul." },
      { title: "Status yang mudah difahami", body: "Garis masa menerangkan apa yang berlaku, siapa memiliki tindakan seterusnya dan sebab item tersekat atau lewat." },
    ],
  },
  "supplier-collaboration": {
    eyebrow: "Kerjasama pembekal",
    title: "Ruang sebut harga dan pemenuhan yang fokus untuk setiap pembekal.",
    intro: "Pengguna pembekal hanya menerima kerja untuk organisasi mereka dan tidak pernah melihat pesaing atau data pemilihan dalaman sulit.",
    sections: [
      { title: "Balas dengan terma lengkap", body: "Hantar harga, kuantiti pesanan minimum, tempoh, kesahan, ketersediaan, caj penghantaran dan dokumen dalam satu borang mudah alih." },
      { title: "Ikuti komitmen bersama", body: "Akui kerja terpilih, simpan sejarah respons dan penjelasan, muat naik dokumen sokongan, serta lihat invois dan status COD yang didaftarkan Axora." },
      { title: "Privasi komersial", body: "Sebutharga pesaing, margin Axora, pelanggan tidak berkaitan dan nota pemilihan peribadi tidak tersedia." },
    ],
  },
  "delivery-tracking": {
    eyebrow: "Penjejakan penghantaran",
    title: "Kemas kini lapangan mudah, bukti boleh dipercayai dan penerimaan bebas.",
    intro: "Pemandu mendapat senarai mudah alih bagi tugas yang diberikan dengan tindakan jelas dan data pelanggan minimum.",
    sections: [
      { title: "Penghantaran seterusnya jelas", body: "Cawangan, alamat diluluskan, tindakan hubungan, ringkasan bungkusan, waktu penerimaan dan arahan khas diberi keutamaan." },
      { title: "Kemas kini status tahan rangkaian lemah", body: "Peristiwa status penghantaran beridentiti unik boleh disimpan pada peranti pemandu dan diselaraskan kemudian. Fail bukti dimuat naik hanya ketika dalam talian dengan maklum balas cuba semula yang jelas." },
      { title: "Bukti bukan kelulusan", body: "Foto pemandu, nota penghantaran, nama serahan dan kuantiti dilaporkan kekal berasingan daripada pengesahan kuantiti serta pemeriksaan penerima syarikat." },
    ],
  },
  "security-and-privacy": {
    eyebrow: "Keselamatan dan privasi",
    title: "Akses perolehan dihadkan mengikut peranan, penyewa, cawangan dan tugasan.",
    intro: "Axora direka berdasarkan keistimewaan minimum, kebenaran sisi pelayan, jemputan selamat, peralihan boleh diaudit dan keterlihatan fail terkawal.",
    sections: [
      { title: "Keselamatan akaun", body: "Pengguna baharu mencipta kata laluan melalui jemputan sekali guna yang tamat tempoh. Kata laluan dihash, sesi boleh dibatalkan dan ralat log masuk tidak mendedahkan kewujudan akaun." },
      { title: "Pengasingan penyewa dan komersial", body: "Pengguna pelanggan dihadkan kepada syarikat dan skop cawangan diluluskan. Identiti pembekal, kos belian, dokumen peribadi dan nota dalaman dilindungi." },
      { title: "Bukti dan pemulihan", body: "Tindakan penting menghasilkan rekod audit dan aliran kerja. Data serta fail pengeluaran mengikuti prosedur sandaran, pemulihan dan undur balik yang disahkan." },
      { title: "Pendedahan bertanggungjawab", body: "Jangan hantar kata laluan, pautan jemputan, bukti pembayaran atau data perolehan sulit melalui borang hubungan awam." },
    ],
  },
  about: {
    eyebrow: "Tentang Axora",
    title: "Penyelarasan perolehan untuk operasi perniagaan yang bertanggungjawab.",
    intro: "Axora menghubungkan pemohon dan pelulus dengan operasi Axora, pembekal, pasukan penghantaran, penerima dan bukti kewangan dalam satu aliran.",
    sections: [
      { title: "Tujuan produk", body: "Platform mengurangkan hamparan, mesej dan pencarian status yang berpecah sambil mengekalkan tanggungjawab jelas pada setiap langkah." },
      { title: "Perkara yang tidak didakwa", body: "Laman ini tidak memaparkan bilangan pelanggan, pensijilan, kerjasama, jaminan penjimatan atau komitmen perkhidmatan yang tidak disokong." },
    ],
  },
  help: {
    eyebrow: "Bantuan dan FAQ",
    title: "Jawapan jelas untuk tugas Axora yang biasa.",
    intro: "Pengguna yang log masuk juga menerima panduan khusus peranan dan boleh menyambung langkah orientasi individu dari Bantuan.",
    sections: [
      { title: "Bagaimanakah saya mendapat akaun?", body: "Pentadbir Axora atau syarikat yang diberi kuasa menghantar jemputan peribadi. Buka pautan sekali guna dan cipta kata laluan anda sendiri." },
      { title: "Mengapa saya tidak nampak sesuatu modul?", body: "Navigasi mengikut peranan, penyewa, tugasan cawangan dan kebenaran semasa. Sekatan yang sama dikuatkuasakan pada pelayan." },
      { title: "Bolehkah pemohon meluluskan permintaan sendiri?", body: "Tidak. Axora mengekalkan pengasingan tugas dan menghalang kelulusan sendiri." },
      { title: "Apakah tindakan bagi masalah penghantaran?", body: "Pemandu merekod bukti operasi dan penerima merekod kuantiti diterima, rosak atau hilang. Perbezaan kekal terbuka sehingga diselesaikan." },
    ],
  },
  privacy: {
    eyebrow: "Notis privasi",
    title: "Cara Axora mengendalikan maklumat akaun dan perolehan.",
    intro: "Notis produk ini menerangkan pengendalian data yang dimaksudkan. Teks undang-undang akhir, tempoh simpanan dan butiran pengawal memerlukan semakan pemilik dan undang-undang sebelum diterbitkan.",
    sections: [
      { title: "Maklumat yang digunakan", body: "Axora memproses data akaun, syarikat, cawangan, permintaan, sebut harga, penghantaran, penerimaan, invois, sokongan, keselamatan dan audit yang diperlukan. Kaunter pelawat awam menggunakan alamat IP awam yang dilihat oleh pelayan untuk memperoleh dan menyimpan cincangan berkunci rahsia yang kekal; alamat IP mentah tidak disimpan. Orang yang berkongsi satu alamat IP awam berkongsi satu tempat pelawat." },
      { title: "Akses dan tujuan", body: "Data digunakan untuk aliran perolehan disahkan, keselamatan, sokongan, komunikasi operasi, bukti dan pemulihan. Akses dihadkan mengikut peranan dan skop." },
      { title: "Borang awam", body: "Pertanyaan disahkan, dihadkan kadarnya, ditapis untuk spam dan disimpan bagi susulan. Jangan masukkan kata laluan atau data perolehan sulit." },
      { title: "Soalan dan hak", body: "Gunakan Hubungi Kami bagi soalan privasi. Permintaan akaun disahkan dikendalikan mengikut kewajipan terpakai dan dasar akhir diluluskan." },
    ],
  },
  terms: {
    eyebrow: "Terma penggunaan",
    title: "Peraturan penggunaan Axora yang dibenarkan.",
    intro: "Terma produk ini ialah draf semakan dan bukan pengganti terma undang-undang yang diluluskan pemilik sebelum penerbitan pengeluaran.",
    sections: [
      { title: "Akses yang dibenarkan", body: "Pengguna mesti menggunakan akaun sendiri, melindungi pautan jemputan dan sesi, serta mengakses hanya kerja yang dibenarkan untuk peranan dan organisasi." },
      { title: "Rekod tepat", body: "Berikan maklumat permintaan, sebut harga, penghantaran, penerimaan, invois dan hubungan yang tepat serta betulkan kesilapan dengan segera." },
      { title: "Penggunaan dilarang", body: "Jangan memintas kawalan akses, memuat naik kandungan berbahaya atau menyalahi undang-undang, menyamar, mendedahkan rekod sulit atau mengganggu operasi." },
      { title: "Status operasi", body: "Skop perkhidmatan, sokongan, penyimpanan, liabiliti dan undang-undang memerlukan kelulusan perniagaan serta undang-undang bertulis yang muktamad." },
    ],
  },
};

const english: PublicMessages = {
  skipToContent: "Skip to main content",
  nav: { home: "Home", how: "How it works", process: "Process", roles: "Solutions by role", security: "Security", about: "About", contact: "Contact Us", login: "Login", menu: "Open menu", primaryNavigation: "Primary navigation", mobileNavigation: "Mobile navigation" },
  language: { label: "Language", detectedTitle: "Use your browser language?", detectedBody: "Axora selected the nearest supported language. Continue or choose another language.", continue: "Continue", choose: "Choose another", close: "Close language selection" },
  home: {
    eyebrow: "Procurement coordination, made accountable",
    title: "One clear path from business need to verified delivery.",
    lead: "Axora helps companies request and approve purchasing while Axora coordinates sourcing, suppliers, delivery, receiving, invoices, and auditable records.",
    primaryAction: "See how Axora works",
    secondaryAction: "Contact Us",
    trustNote: "Built for role-based, multi-company procurement. No public signup and no shared temporary passwords.",
    heroVisualLabel: "Procurement lifecycle overview",
    requestLabel: "Request",
    requestBody: "Branch need recorded",
    approveLabel: "Approve",
    approveBody: "Budget and evidence",
    deliverLabel: "Deliver",
    deliverBody: "Proof and receiving",
    traceableLabel: "Traceable record",
    processEyebrow: "01 — Process",
    rolesEyebrow: "02 — Roles",
    trackingEyebrow: "03 — Tracking",
    securityEyebrow: "04 — Security",
    contactEyebrow: "Contact Axora",
    processTitle: "A complete procurement lifecycle",
    processLead: "Every handoff has a responsible role, a plain-language status, and evidence that stays with the record.",
    stages: [
      { title: "Identify need", body: "A branch or employee identifies a required product or service." },
      { title: "Create request", body: "The requester adds items, quantities, timing, branch, and context." },
      { title: "Company approval", body: "An authorized approver checks necessity, budget, and evidence." },
      { title: "Source suppliers", body: "Axora privately requests and evaluates eligible quotations." },
      { title: "Coordinate order", body: "The selected supplier acknowledges terms and preparation." },
      { title: "Track delivery", body: "Assigned delivery users record schedule, travel, arrival, and proof." },
      { title: "Receive and inspect", body: "A company receiver separately confirms accepted and discrepant quantities." },
      { title: "Match records", body: "Request, receipt, and invoice are compared and exceptions are resolved." },
      { title: "Complete and retain", body: "COD/payment status, completion, documents, and audit history remain traceable." },
    ],
    rolesTitle: "A focused workspace for every participant",
    rolesLead: "People see the next work they own, not every module in the platform.",
    roles: [
      { title: "Companies", body: "Manage people, branches, budgets, requests, approvals, receiving, and permitted finance records.", href: "company-procurement" },
      { title: "Suppliers", body: "Respond to assigned quotation requests and fulfilment work without seeing competitors.", href: "supplier-collaboration" },
      { title: "Delivery teams", body: "Use a simple mobile workflow for assigned stops, issues, and evidence.", href: "delivery-tracking" },
    ],
    trackingTitle: "A timeline that explains what happened",
    trackingBody: "Requests, approvals, quotations, orders, deliveries, receipts, discrepancies, invoices, and COD updates produce consistent tenant-scoped events.",
    securityTitle: "Commercial boundaries stay clear",
    securityBody: "Customer users do not see private suppliers, competitor quotations, Axora buying cost, or another company’s records. Supplier and delivery users receive the minimum scope required for assigned work.",
    closingTitle: "Ready to discuss your procurement workflow?",
    closingBody: "Tell Axora about your company, branch structure, and current purchasing process. Do not include passwords or confidential records.",
  },
  contact: { eyebrow: "Contact Axora", title: "Tell us about your procurement workflow.", intro: "Share enough context for a useful reply. Do not send passwords, invitation links, payment evidence, or confidential procurement documents.", name: "Your name", email: "Work email", company: "Company", phone: "Phone (optional)", subject: "What would you like to discuss?", message: "Message", privacy: "I understand Axora will use this information to respond to my enquiry.", submit: "Send enquiry", sending: "Sending…", success: "Thank you. Your enquiry has been recorded and Axora will follow up.", failure: "The enquiry could not be sent. Please check the form and try again.", unavailable: "Contact submission is temporarily unavailable. Please try again later.", securityNote: "Your enquiry is rate limited, checked for automated abuse, and stored for authorized Axora follow-up. Never include passwords or invitation links.", validationNote: "Fields are validated before submission." },
  footer: { summary: "Secure, role-aware procurement coordination from request to verified record.", product: "Product", company: "Company", legal: "Legal", help: "Help / FAQ", privacy: "Privacy", terms: "Terms", rights: "All rights reserved." },
  pages: englishPages,
};

const arabic: PublicMessages = {
  ...english,
  skipToContent: "انتقل إلى المحتوى الرئيسي",
  nav: { home: "الرئيسية", how: "كيف تعمل أكسورا", process: "المراحل", roles: "الحلول حسب الدور", security: "الأمان", about: "عن أكسورا", contact: "تواصل معنا", login: "تسجيل الدخول", menu: "فتح القائمة", primaryNavigation: "التنقل الرئيسي", mobileNavigation: "التنقل عبر الجوال" },
  language: { label: "اللغة", detectedTitle: "هل تريد استخدام لغة المتصفح؟", detectedBody: "اختارت أكسورا أقرب لغة مدعومة. يمكنك المتابعة أو اختيار لغة أخرى.", continue: "متابعة", choose: "اختيار لغة أخرى", close: "إغلاق اختيار اللغة" },
  home: {
    ...english.home,
    eyebrow: "تنسيق مشتريات واضح وقابل للمساءلة",
    title: "مسار واحد واضح من احتياج الشركة إلى تسليم موثّق.",
    lead: "تساعد أكسورا الشركات على طلب المشتريات واعتمادها، بينما تنسّق التوريد والموردين والتسليم والاستلام والفواتير والسجل القابل للتدقيق.",
    primaryAction: "تعرّف على طريقة العمل",
    secondaryAction: "تواصل معنا",
    trustNote: "منصة مشتريات متعددة الشركات بصلاحيات محددة. لا يوجد تسجيل عام ولا كلمات مرور مؤقتة مشتركة.",
    heroVisualLabel: "نظرة عامة على دورة المشتريات",
    requestLabel: "الطلب",
    requestBody: "تسجيل احتياج الفرع",
    approveLabel: "الاعتماد",
    approveBody: "الميزانية والأدلة",
    deliverLabel: "التسليم",
    deliverBody: "الإثبات والاستلام",
    traceableLabel: "سجل قابل للتتبع",
    processEyebrow: "01 — المراحل",
    rolesEyebrow: "02 — الأدوار",
    trackingEyebrow: "03 — التتبع",
    securityEyebrow: "04 — الأمان",
    contactEyebrow: "تواصل مع أكسورا",
    processTitle: "دورة مشتريات متكاملة",
    processLead: "لكل عملية تسليم مسؤول وحالة واضحة ودليل محفوظ مع السجل.",
    stages: [
      { title: "تحديد الاحتياج", body: "يحدد الفرع أو الموظف المنتج أو الخدمة المطلوبة." },
      { title: "إنشاء الطلب", body: "يضيف مقدم الطلب الأصناف والكميات والموعد والفرع والتفاصيل." },
      { title: "اعتماد الشركة", body: "يراجع المعتمد المخوّل الحاجة والميزانية والمستندات." },
      { title: "البحث عن المورد", body: "تطلب أكسورا عروضًا مؤهلة وتقارنها بصورة خاصة." },
      { title: "تنسيق الطلب", body: "يؤكد المورد المختار الشروط وبدء التجهيز." },
      { title: "تتبع التسليم", body: "يسجل فريق التسليم الجدول والوصول والإثبات والمشكلات." },
      { title: "الاستلام والفحص", body: "يؤكد مستلم الشركة الكميات المقبولة والفروقات بشكل مستقل." },
      { title: "مطابقة السجلات", body: "تتم مقارنة الطلب والاستلام والفاتورة وحل الاستثناءات." },
      { title: "الإكمال والحفظ", body: "تبقى حالة الدفع والسجلات والمستندات قابلة للتتبع." },
    ],
    rolesTitle: "مساحة عمل مركزة لكل مشارك",
    rolesLead: "يرى كل شخص العمل التالي الذي يخصه بدلًا من رؤية جميع وحدات المنصة.",
    roles: [
      { title: "الشركات", body: "إدارة الموظفين والفروع والميزانيات والطلبات والاعتمادات والاستلام والسجلات المسموحة.", href: "company-procurement" },
      { title: "الموردون", body: "الرد على طلبات الأسعار والأعمال المسندة دون الاطلاع على المنافسين.", href: "supplier-collaboration" },
      { title: "فرق التسليم", body: "استخدام تجربة جوال بسيطة للمهام المسندة والمشكلات والإثبات.", href: "delivery-tracking" },
    ],
    trackingTitle: "خط زمني يوضح ما حدث",
    trackingBody: "تُسجل الطلبات والاعتمادات وعروض الأسعار والتسليم والاستلام والفواتير والدفع كأحداث متسقة ومحددة للشركة.",
    securityTitle: "حدود تجارية واضحة",
    securityBody: "لا يرى مستخدمو الشركات الموردين الخاصين أو عروض المنافسين أو تكلفة شراء أكسورا أو بيانات شركة أخرى.",
    closingTitle: "هل ترغب في مناقشة مسار المشتريات لديك؟",
    closingBody: "أخبر أكسورا عن شركتك وفروعك وطريقة الشراء الحالية، من دون إرسال كلمات مرور أو سجلات سرية.",
  },
  contact: { eyebrow: "تواصل مع أكسورا", title: "أخبرنا عن مسار المشتريات في شركتك.", intro: "أرسل سياقًا كافيًا لرد مفيد. لا ترسل كلمات مرور أو روابط دعوات أو إثباتات دفع أو مستندات سرية.", name: "الاسم", email: "البريد الإلكتروني للعمل", company: "الشركة", phone: "الهاتف (اختياري)", subject: "موضوع التواصل", message: "الرسالة", privacy: "أفهم أن أكسورا ستستخدم هذه المعلومات للرد على استفساري.", submit: "إرسال الاستفسار", sending: "جارٍ الإرسال…", success: "شكرًا لك. تم تسجيل الاستفسار وستتواصل معك أكسورا.", failure: "تعذر إرسال الاستفسار. تحقق من البيانات وحاول مرة أخرى.", unavailable: "خدمة التواصل غير متاحة مؤقتًا. حاول لاحقًا.", securityNote: "يخضع الاستفسار لتحديد المعدل وفحص الاستخدام الآلي، ويُحفظ لمتابعة مخوّلة من أكسورا. لا تضع كلمة مرور أو رابط دعوة.", validationNote: "يتم التحقق من الحقول قبل الإرسال." },
  footer: { summary: "تنسيق مشتريات آمن ومحدد الصلاحيات من الطلب إلى السجل الموثق.", product: "المنتج", company: "الشركة", legal: "قانوني", help: "المساعدة والأسئلة", privacy: "الخصوصية", terms: "الشروط", rights: "جميع الحقوق محفوظة." },
  pages: arabicPages,
};

const malay: PublicMessages = {
  ...english,
  skipToContent: "Langkau ke kandungan utama",
  nav: { home: "Utama", how: "Cara Axora berfungsi", process: "Proses", roles: "Penyelesaian mengikut peranan", security: "Keselamatan", about: "Tentang Axora", contact: "Hubungi Kami", login: "Log masuk", menu: "Buka menu", primaryNavigation: "Navigasi utama", mobileNavigation: "Navigasi mudah alih" },
  language: { label: "Bahasa", detectedTitle: "Gunakan bahasa pelayar anda?", detectedBody: "Axora memilih bahasa disokong yang paling hampir. Teruskan atau pilih bahasa lain.", continue: "Teruskan", choose: "Pilih bahasa lain", close: "Tutup pilihan bahasa" },
  home: {
    ...english.home,
    eyebrow: "Penyelarasan perolehan yang boleh dipertanggungjawabkan",
    title: "Satu laluan jelas daripada keperluan perniagaan kepada penghantaran yang disahkan.",
    lead: "Axora membantu syarikat membuat dan meluluskan permintaan, sementara Axora menyelaras sumber, pembekal, penghantaran, penerimaan, invois dan rekod audit.",
    primaryAction: "Lihat cara Axora berfungsi",
    secondaryAction: "Hubungi Kami",
    trustNote: "Dibina untuk perolehan berbilang syarikat berasaskan peranan. Tiada pendaftaran awam atau kata laluan sementara yang dikongsi.",
    heroVisualLabel: "Gambaran kitaran perolehan",
    requestLabel: "Permintaan",
    requestBody: "Keperluan cawangan direkod",
    approveLabel: "Kelulusan",
    approveBody: "Bajet dan bukti",
    deliverLabel: "Penghantaran",
    deliverBody: "Bukti dan penerimaan",
    traceableLabel: "Rekod boleh dijejak",
    processEyebrow: "01 — Proses",
    rolesEyebrow: "02 — Peranan",
    trackingEyebrow: "03 — Penjejakan",
    securityEyebrow: "04 — Keselamatan",
    contactEyebrow: "Hubungi Axora",
    processTitle: "Kitaran perolehan yang lengkap",
    processLead: "Setiap serahan mempunyai pemilik, status yang jelas dan bukti yang kekal bersama rekod.",
    stages: [
      { title: "Kenal pasti keperluan", body: "Cawangan atau pekerja mengenal pasti produk atau perkhidmatan yang diperlukan." },
      { title: "Buat permintaan", body: "Pemohon menambah item, kuantiti, tarikh, cawangan dan konteks." },
      { title: "Kelulusan syarikat", body: "Pelulus yang diberi kuasa menyemak keperluan, bajet dan bukti." },
      { title: "Sumber pembekal", body: "Axora meminta dan menilai sebut harga yang layak secara peribadi." },
      { title: "Selaras pesanan", body: "Pembekal terpilih mengesahkan terma dan persediaan." },
      { title: "Jejak penghantaran", body: "Pengguna penghantaran merekod jadual, perjalanan, ketibaan dan bukti." },
      { title: "Terima dan periksa", body: "Penerima syarikat mengesahkan kuantiti diterima dan perbezaan secara berasingan." },
      { title: "Padankan rekod", body: "Permintaan, penerimaan dan invois dibandingkan; pengecualian diselesaikan." },
      { title: "Selesai dan simpan", body: "Status COD, dokumen dan sejarah audit kekal boleh dijejaki." },
    ],
    rolesTitle: "Ruang kerja fokus untuk setiap peserta",
    rolesLead: "Setiap orang melihat kerja seterusnya yang dimiliki, bukan semua modul platform.",
    roles: [
      { title: "Syarikat", body: "Urus orang, cawangan, bajet, permintaan, kelulusan, penerimaan dan rekod kewangan yang dibenarkan.", href: "company-procurement" },
      { title: "Pembekal", body: "Balas permintaan sebut harga dan kerja pemenuhan tanpa melihat pesaing.", href: "supplier-collaboration" },
      { title: "Pasukan penghantaran", body: "Gunakan aliran mudah alih untuk tugasan, isu dan bukti yang diberikan.", href: "delivery-tracking" },
    ],
    trackingTitle: "Garis masa yang menerangkan apa yang berlaku",
    trackingBody: "Permintaan, kelulusan, sebut harga, penghantaran, penerimaan, invois dan COD menghasilkan peristiwa konsisten dalam skop penyewa.",
    securityTitle: "Sempadan komersial kekal jelas",
    securityBody: "Pengguna pelanggan tidak melihat pembekal persendirian, sebut harga pesaing, kos belian Axora atau rekod syarikat lain.",
    closingTitle: "Bersedia membincangkan aliran perolehan anda?",
    closingBody: "Beritahu Axora tentang syarikat, struktur cawangan dan proses pembelian semasa tanpa memasukkan kata laluan atau rekod sulit.",
  },
  contact: { eyebrow: "Hubungi Axora", title: "Beritahu kami tentang aliran perolehan anda.", intro: "Kongsi konteks yang mencukupi untuk jawapan berguna. Jangan hantar kata laluan, pautan jemputan, bukti pembayaran atau dokumen sulit.", name: "Nama anda", email: "E-mel kerja", company: "Syarikat", phone: "Telefon (pilihan)", subject: "Perkara yang ingin dibincangkan", message: "Mesej", privacy: "Saya faham Axora akan menggunakan maklumat ini untuk menjawab pertanyaan saya.", submit: "Hantar pertanyaan", sending: "Menghantar…", success: "Terima kasih. Pertanyaan anda telah direkodkan dan Axora akan membuat susulan.", failure: "Pertanyaan tidak dapat dihantar. Semak borang dan cuba lagi.", unavailable: "Penghantaran borang tidak tersedia buat sementara waktu. Cuba lagi kemudian.", securityNote: "Pertanyaan dihadkan kadarnya, diperiksa untuk penyalahgunaan automatik dan disimpan untuk susulan Axora yang dibenarkan. Jangan masukkan kata laluan atau pautan jemputan.", validationNote: "Medan disahkan sebelum dihantar." },
  footer: { summary: "Penyelarasan perolehan selamat dan berasaskan peranan daripada permintaan kepada rekod disahkan.", product: "Produk", company: "Syarikat", legal: "Perundangan", help: "Bantuan / FAQ", privacy: "Privasi", terms: "Terma", rights: "Hak cipta terpelihara." },
  pages: malayPages,
};

export const PUBLIC_MESSAGES: Record<SupportedLocale, PublicMessages> = {
  en: english,
  ar: arabic,
  ms: malay,
};

export function publicMessages(locale: SupportedLocale) {
  return PUBLIC_MESSAGES[locale];
}

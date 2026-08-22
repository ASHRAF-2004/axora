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
  "delivery-tracking",
  "security-and-privacy",
  "about",
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
      { title: "Axora prepares and delivers", body: "After approval and Pay, Axora finalizes the invoice, prepares the order and delivers it without exposing private operational information." },
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
      { title: "3. Pay and invoice", body: "Pay confirms the server-authoritative total, records payment once, commits the budget and finalizes one permanent invoice." },
      { title: "4. Prepare and deliver", body: "Axora prepares the approved order, records delivery progress and exceptions, and delivers it to the approved location." },
      { title: "5. Receive and close", body: "The customer records receipt evidence and any discrepancy. Completion, invoice, notifications and audit history remain traceable." },
    ],
  },
  "solutions-by-role": {
    eyebrow: "Solutions by role",
    title: "Each person sees the next work that belongs to them.",
    intro: "Axora avoids one crowded dashboard for every role. Permissions, tenant, branch assignment, and workflow state shape each experience.",
    sections: [
      { title: "Requesters and approvers", body: "Requesters shop and track their work. Approvers receive a decision queue with budget and evidence context, while separation of duties prevents self-approval." },
      { title: "Company and branch administrators", body: "Administrators manage permitted people, branch scopes, budgets, approvals, delivery status, and company-visible reporting." },
      { title: "Finance and auditors", body: "Finance reviewers handle invoices, payment evidence, matching, and exceptions. Auditors receive read-only evidence and immutable event history." },
      { title: "Delivery and receiving", body: "Authorized delivery operations stay separate from customer receipt acceptance and exceptions." },
    ],
  },
  "company-procurement": {
    eyebrow: "Company procurement",
    title: "Control branch purchasing without losing everyday simplicity.",
    intro: "Customer companies manage their own people, branches, budgets, requests, approvals, receiving, and permitted finance records.",
    sections: [
      { title: "Clear company boundaries", body: "Company users see only their authorized company and branch records; private operational and commercial information is excluded." },
      { title: "Branch-aware budgets", body: "Requests are attached to a branch and approved commitments are reflected against the correct monthly budget period." },
      { title: "Useful status, not mystery", body: "Plain-language timelines explain what happened, who owns the next action, and why an item is blocked or delayed." },
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
      { title: "Tenant and commercial separation", body: "Customer users are restricted to their company and approved branch scope. Private operational documents and internal commercial information remain protected." },
      { title: "Evidence and recovery", body: "Important actions produce audit and workflow records. Production data and persistent files follow verified backup, restore, and rollback procedures." },
      { title: "Responsible disclosure", body: "Do not send passwords, invitation links, payment evidence, or confidential procurement data through the public contact form." },
    ],
  },
  about: {
    eyebrow: "About Axora",
    title: "Procurement coordination built for accountable business operations.",
    intro: "Axora connects company requesters and approvers with Agents, delivery operations, receivers, invoices, and auditable finance evidence in one coherent workflow.",
    sections: [
      { title: "Product purpose", body: "The platform reduces fragmented spreadsheets, messages, and status chasing while preserving clear responsibility at every step." },
      { title: "What Axora does not claim", body: "This website does not present unsupported customer numbers, certifications, partnerships, savings guarantees, or service commitments." },
    ],
  },
  privacy: {
    eyebrow: "Privacy notice",
    title: "How Axora handles account and procurement information.",
    intro: "This product notice describes the intended handling of Axora platform data. Final legal wording, retention periods, and controller details require owner and legal review before production publication.",
    sections: [
      { title: "Information used", body: "Axora processes account, company, branch, request, payment, delivery, receiving, invoice, support, security, and audit information required to operate the service. The public visitor choice uses a signed, HTTP-only first-party cookie to remember a choice in this browser for up to one year. Clearing site data or changing browser or device may create a new anonymous choice. Axora does not store raw IP addresses or use durable IP or device fingerprints for visitor identity; a short-lived network-derived rate bucket is used only to prevent abuse." },
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
      { title: "Accurate records", body: "Users should provide accurate request, delivery, receiving, invoice, and contact information and correct discovered errors promptly." },
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
      { title: "أكسورا تجهز وتسلم", body: "بعد الاعتماد والدفع، تنهي أكسورا الفاتورة وتجهز الطلب وتسلمه من دون كشف المعلومات التشغيلية الخاصة." },
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
      { title: "3. الدفع والفاتورة", body: "يؤكد إجراء الدفع الإجمالي المعتمد من الخادم ويسجل الدفع مرة واحدة ويلتزم بالميزانية وينهي فاتورة دائمة واحدة." },
      { title: "4. التجهيز والتسليم", body: "تجهز أكسورا الطلب المعتمد وتسجل تقدم التسليم والاستثناءات ثم تسلمه إلى الموقع المعتمد." },
      { title: "5. الاستلام والإغلاق", body: "يسجل العميل إثبات الاستلام وأي فرق. وتبقى حالة الإكمال والفاتورة والإشعارات وسجل التدقيق قابلة للتتبع." },
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
      { title: "مسؤول التوصيل والمستلمون", body: "يرى مسؤول التوصيل الأعمال المدفوعة والمسندة إليه فقط، ويسجل مستلمو العميل قبول التسليم والاستثناءات بصورة مستقلة." },
    ],
  },
  "company-procurement": {
    eyebrow: "مشتريات الشركات",
    title: "تحكم في مشتريات الفروع مع الحفاظ على سهولة العمل اليومي.",
    intro: "تدير الشركات موظفيها وفروعها وميزانياتها وطلباتها واعتماداتها واستلامها والسجلات المالية المسموح بها.",
    sections: [
      { title: "حدود واضحة لكل شركة", body: "يرى مستخدم الشركة سجلات شركته وفروعه المصرح بها فقط، وتُستبعد المعلومات التشغيلية والتجارية الخاصة." },
      { title: "ميزانيات مرتبطة بالفروع", body: "يرتبط كل طلب بفرع، وتنعكس الالتزامات المعتمدة على ميزانية الفرع والفترة الشهرية الصحيحة." },
      { title: "حالة مفهومة وليست غامضة", body: "توضح الخطوط الزمنية بلغة سهلة ما حدث ومن يملك الإجراء التالي ولماذا تعطل الطلب أو تأخر." },
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
      { title: "عزل الشركات والبيانات التجارية", body: "يقتصر مستخدم العميل على شركته وفروعه المعتمدة، وتبقى المستندات التشغيلية والمعلومات التجارية الداخلية محمية." },
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
  privacy: {
    eyebrow: "إشعار الخصوصية",
    title: "كيف تتعامل أكسورا مع بيانات الحساب والمشتريات.",
    intro: "يصف هذا الإشعار طريقة التعامل المقصودة مع بيانات المنصة. تتطلب الصياغة القانونية النهائية وفترات الاحتفاظ وتفاصيل الجهة المسؤولة مراجعة المالك والمستشار القانوني قبل النشر.",
    sections: [
      { title: "المعلومات المستخدمة", body: "تعالج أكسورا بيانات الحساب والشركة والفرع والطلبات والعروض والتسليم والاستلام والفواتير والدعم والأمان والتدقيق اللازمة لتشغيل الخدمة. يستخدم اختيار الزائر العام ملف ارتباط موقّعًا من الطرف الأول ومتاحًا للخادم فقط لتذكر الاختيار في هذا المتصفح لمدة تصل إلى سنة. قد يؤدي مسح بيانات الموقع أو تغيير المتصفح أو الجهاز إلى إنشاء اختيار مجهول جديد. لا تخزن أكسورا عناوين IP الخام ولا تستخدم بصمات دائمة لعنوان IP أو الجهاز كهوية للزائر؛ ويُستخدم نطاق شبكة قصير الأجل فقط لمنع الإساءة." },
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
      { title: "Axora menyediakan dan menghantar", body: "Selepas kelulusan dan Bayar, Axora memuktamadkan invois, menyediakan pesanan dan menghantarnya tanpa mendedahkan maklumat operasi persendirian." },
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
      { title: "3. Bayar dan invois", body: "Bayar mengesahkan jumlah berautoriti pelayan, merekod bayaran sekali, mengikat bajet dan memuktamadkan satu invois kekal." },
      { title: "4. Sedia dan hantar", body: "Axora menyediakan pesanan yang diluluskan, merekod kemajuan dan pengecualian penghantaran, lalu menghantarnya ke lokasi diluluskan." },
      { title: "5. Terima dan tutup", body: "Pelanggan merekod bukti penerimaan dan sebarang perbezaan. Penyiapan, invois, notifikasi dan audit kekal boleh dijejaki." },
    ],
  },
  "solutions-by-role": {
    eyebrow: "Penyelesaian mengikut peranan",
    title: "Setiap orang melihat kerja seterusnya yang menjadi tanggungjawabnya.",
    intro: "Axora tidak memaksa satu papan pemuka sesak untuk semua. Peranan, penyewa, cawangan dan keadaan aliran kerja membentuk pengalaman.",
    sections: [
      { title: "Pemohon dan pelulus", body: "Pemohon membuat dan menjejak permintaan sendiri. Pelulus menerima barisan keputusan dengan konteks bajet dan bukti; pengasingan tugas menghalang kelulusan sendiri." },
      { title: "Pentadbir syarikat dan cawangan", body: "Pentadbir mengurus orang, skop cawangan, bajet, kelulusan, status penghantaran dan laporan yang dibenarkan." },
      { title: "Kewangan dan juruaudit", body: "Penyemak kewangan mengurus invois, bukti payment, padanan dan pengecualian. Juruaudit mendapat bukti baca sahaja dan sejarah peristiwa kekal." },
      { title: "Penghantar dan penerima", body: "Penghantar hanya melihat kerja berbayar yang ditugaskan, manakala penerima pelanggan merekod penerimaan dan pengecualian secara bebas." },
    ],
  },
  "company-procurement": {
    eyebrow: "Perolehan syarikat",
    title: "Kawal pembelian cawangan tanpa menjejaskan kesederhanaan harian.",
    intro: "Syarikat pelanggan mengurus orang, cawangan, bajet, permintaan, kelulusan, penerimaan dan rekod kewangan yang dibenarkan.",
    sections: [
      { title: "Sempadan syarikat yang jelas", body: "Pengguna syarikat hanya melihat rekod syarikat dan cawangan yang dibenarkan; maklumat operasi dan komersial persendirian dikecualikan." },
      { title: "Bajet mengikut cawangan", body: "Permintaan diikat kepada cawangan dan komitmen diluluskan dikira pada tempoh bajet bulanan yang betul." },
      { title: "Status yang mudah difahami", body: "Garis masa menerangkan apa yang berlaku, siapa memiliki tindakan seterusnya dan sebab item tersekat atau lewat." },
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
      { title: "Pengasingan penyewa dan komersial", body: "Pengguna pelanggan dihadkan kepada syarikat dan skop cawangan diluluskan. Dokumen operasi persendirian dan maklumat komersial dalaman kekal dilindungi." },
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
  privacy: {
    eyebrow: "Notis privasi",
    title: "Cara Axora mengendalikan maklumat akaun dan perolehan.",
    intro: "Notis produk ini menerangkan pengendalian data yang dimaksudkan. Teks undang-undang akhir, tempoh simpanan dan butiran pengawal memerlukan semakan pemilik dan undang-undang sebelum diterbitkan.",
    sections: [
      { title: "Maklumat yang digunakan", body: "Axora memproses data akaun, syarikat, cawangan, permintaan, sebut harga, penghantaran, penerimaan, invois, sokongan, keselamatan dan audit yang diperlukan. Pilihan pelawat awam menggunakan kuki pihak pertama yang ditandatangani dan HTTP sahaja untuk mengingati pilihan dalam pelayar ini sehingga satu tahun. Memadam data laman atau menukar pelayar atau peranti mungkin menghasilkan pilihan tanpa nama yang baharu. Axora tidak menyimpan alamat IP mentah atau menggunakan cap jari IP atau peranti yang kekal sebagai identiti pelawat; baldi kadar berasaskan rangkaian jangka pendek digunakan hanya untuk mencegah penyalahgunaan." },
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
    lead: "Axora helps companies request, approve and pay while Axora prepares orders, coordinates delivery, records invoices and preserves auditable evidence.",
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
      { title: "Request", body: "Choose approved products and submit the company request." },
      { title: "Approve", body: "An authorized company approver checks the request and budget." },
      { title: "Pay", body: "The trusted server total is recorded exactly once." },
      { title: "Invoice", body: "Axora finalizes the invoice and its permanent record." },
      { title: "Prepare", body: "Axora prepares the approved order for delivery." },
      { title: "Deliver", body: "The order moves through its authorized delivery journey." },
      { title: "Track", body: "The company receives privacy-safe status and arrival updates." },
      { title: "Complete", body: "Receipt evidence and completion remain traceable." },
    ],
    rolesTitle: "A focused workspace for every participant",
    rolesLead: "People see the next work they own, not every module in the platform.",
    roles: [
      { title: "Companies", body: "Manage people, branches, budgets, requests, approvals, receiving, and permitted finance records.", href: "company-procurement" },
      { title: "Delivery operations", body: "Use a focused mobile workflow to complete authorized deliveries and record evidence.", href: "delivery-tracking" },
    ],
    trackingTitle: "A timeline that explains what happened",
    trackingBody: "Requests, approvals, payments, invoices, preparation, deliveries, receipts and discrepancies produce consistent tenant-scoped events.",
    securityTitle: "Commercial boundaries stay clear",
    securityBody: "Customer users do not see private internal cost, internal commercial data, or another company’s records. Delivery users receive the minimum scope required for assigned work.",
    closingTitle: "Ready to discuss your procurement workflow?",
    closingBody: "Tell Axora about your company, branch structure, and current request and delivery process. Do not include passwords or confidential records.",
  },
  contact: { eyebrow: "Contact Axora", title: "Tell us about your procurement workflow.", intro: "Share enough context for a useful reply. Do not send passwords, invitation links, payment evidence, or confidential procurement documents.", name: "Your name", email: "Work email", company: "Company", phone: "Phone (optional)", subject: "What would you like to discuss?", message: "Message", privacy: "I understand Axora will use this information to respond to my enquiry.", submit: "Send enquiry", sending: "Sending…", success: "Thank you. Your enquiry has been recorded and Axora will follow up.", failure: "The enquiry could not be sent. Please check the form and try again.", unavailable: "Contact submission is temporarily unavailable. Please try again later.", securityNote: "Your enquiry is rate limited, checked for automated abuse, and stored for authorized Axora follow-up. Never include passwords or invitation links.", validationNote: "Fields are validated before submission." },
  footer: { summary: "Secure, role-aware procurement coordination from request to verified record.", product: "Product", company: "Company", legal: "Legal", privacy: "Privacy", terms: "Terms", rights: "All rights reserved." },
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
    lead: "تساعد أكسورا الشركات على تقديم الطلبات واعتمادها ودفعها، ثم تجهز الطلب وتنسق التسليم والفواتير والأدلة القابلة للتدقيق.",
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
      { title: "الطلب", body: "اختر المنتجات المعتمدة وأرسل طلب الشركة." },
      { title: "الاعتماد", body: "يراجع معتمد مخول الطلب والميزانية." },
      { title: "الدفع", body: "يُسجل الإجمالي الموثوق من الخادم مرة واحدة." },
      { title: "الفاتورة", body: "تُعتمد الفاتورة وسجلها الدائم." },
      { title: "التجهيز", body: "تجهز أكسورا الطلب المعتمد للتسليم." },
      { title: "التسليم", body: "ينتقل الطلب عبر رحلة التسليم المخولة." },
      { title: "التتبع", body: "تتلقى الشركة تحديثات آمنة للحالة والوصول." },
      { title: "الإكمال", body: "يبقى إثبات الاستلام والإكمال قابلاً للتتبع." },
    ],
    rolesTitle: "مساحة عمل مركزة لكل مشارك",
    rolesLead: "يرى كل شخص العمل التالي الذي يخصه بدلًا من رؤية جميع وحدات المنصة.",
    roles: [
      { title: "الشركات", body: "إدارة الموظفين والفروع والميزانيات والطلبات والاعتمادات والاستلام والسجلات المسموحة.", href: "company-procurement" },
      { title: "عمليات التسليم", body: "استخدام تجربة جوال مركزة لإكمال عمليات التسليم المخولة وتسجيل الإثبات.", href: "delivery-tracking" },
    ],
    trackingTitle: "خط زمني يوضح ما حدث",
    trackingBody: "تُسجل الطلبات والاعتمادات والدفع والفواتير والتجهيز والتسليم والاستلام كأحداث متسقة ومحددة للشركة.",
    securityTitle: "حدود تجارية واضحة",
    securityBody: "لا يرى مستخدمو الشركات البيانات التشغيلية والتجارية الداخلية أو بيانات شركة أخرى.",
    closingTitle: "هل ترغب في مناقشة مسار المشتريات لديك؟",
    closingBody: "أخبر أكسورا عن شركتك وفروعك ومسار الطلب والتسليم، من دون إرسال كلمات مرور أو سجلات سرية.",
  },
  contact: { eyebrow: "تواصل مع أكسورا", title: "أخبرنا عن مسار المشتريات في شركتك.", intro: "أرسل سياقًا كافيًا لرد مفيد. لا ترسل كلمات مرور أو روابط دعوات أو إثباتات دفع أو مستندات سرية.", name: "الاسم", email: "البريد الإلكتروني للعمل", company: "الشركة", phone: "الهاتف (اختياري)", subject: "موضوع التواصل", message: "الرسالة", privacy: "أفهم أن أكسورا ستستخدم هذه المعلومات للرد على استفساري.", submit: "إرسال الاستفسار", sending: "جارٍ الإرسال…", success: "شكرًا لك. تم تسجيل الاستفسار وستتواصل معك أكسورا.", failure: "تعذر إرسال الاستفسار. تحقق من البيانات وحاول مرة أخرى.", unavailable: "خدمة التواصل غير متاحة مؤقتًا. حاول لاحقًا.", securityNote: "يخضع الاستفسار لتحديد المعدل وفحص الاستخدام الآلي، ويُحفظ لمتابعة مخوّلة من أكسورا. لا تضع كلمة مرور أو رابط دعوة.", validationNote: "يتم التحقق من الحقول قبل الإرسال." },
  footer: { summary: "تنسيق مشتريات آمن ومحدد الصلاحيات من الطلب إلى السجل الموثق.", product: "المنتج", company: "الشركة", legal: "قانوني", privacy: "الخصوصية", terms: "الشروط", rights: "جميع الحقوق محفوظة." },
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
    lead: "Axora membantu syarikat meminta, meluluskan dan membayar, kemudian menyediakan pesanan, menyelaras penghantaran, invois dan bukti audit.",
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
      { title: "Permintaan", body: "Pilih produk diluluskan dan hantar permintaan syarikat." },
      { title: "Kelulusan", body: "Pelulus syarikat menyemak permintaan dan bajet." },
      { title: "Bayar", body: "Jumlah sah daripada pelayan direkodkan sekali sahaja." },
      { title: "Invois", body: "Axora memuktamadkan invois dan rekod kekalnya." },
      { title: "Sediakan", body: "Axora menyediakan pesanan diluluskan untuk penghantaran." },
      { title: "Hantar", body: "Pesanan melalui perjalanan penghantaran yang dibenarkan." },
      { title: "Jejak", body: "Syarikat menerima status dan kemas kini ketibaan yang selamat." },
      { title: "Selesai", body: "Bukti penerimaan dan penyelesaian kekal boleh dijejaki." },
    ],
    rolesTitle: "Ruang kerja fokus untuk setiap peserta",
    rolesLead: "Setiap orang melihat kerja seterusnya yang dimiliki, bukan semua modul platform.",
    roles: [
      { title: "Syarikat", body: "Urus orang, cawangan, bajet, permintaan, kelulusan, penerimaan dan rekod kewangan yang dibenarkan.", href: "company-procurement" },
      { title: "Penghantar", body: "Gunakan aliran mudah alih untuk melengkapkan penghantaran yang ditugaskan dan merekod bukti.", href: "delivery-tracking" },
    ],
    trackingTitle: "Garis masa yang menerangkan apa yang berlaku",
    trackingBody: "Permintaan, kelulusan, bayaran, invois, persediaan, penghantaran dan penerimaan menghasilkan peristiwa konsisten dalam skop penyewa.",
    securityTitle: "Sempadan komersial kekal jelas",
    securityBody: "Pengguna pelanggan tidak melihat data operasi atau komersial dalaman atau rekod syarikat lain.",
    closingTitle: "Bersedia membincangkan aliran perolehan anda?",
    closingBody: "Beritahu Axora tentang syarikat, struktur cawangan serta proses permintaan dan penghantaran tanpa memasukkan kata laluan atau rekod sulit.",
  },
  contact: { eyebrow: "Hubungi Axora", title: "Beritahu kami tentang aliran perolehan anda.", intro: "Kongsi konteks yang mencukupi untuk jawapan berguna. Jangan hantar kata laluan, pautan jemputan, bukti pembayaran atau dokumen sulit.", name: "Nama anda", email: "E-mel kerja", company: "Syarikat", phone: "Telefon (pilihan)", subject: "Perkara yang ingin dibincangkan", message: "Mesej", privacy: "Saya faham Axora akan menggunakan maklumat ini untuk menjawab pertanyaan saya.", submit: "Hantar pertanyaan", sending: "Menghantar…", success: "Terima kasih. Pertanyaan anda telah direkodkan dan Axora akan membuat susulan.", failure: "Pertanyaan tidak dapat dihantar. Semak borang dan cuba lagi.", unavailable: "Penghantaran borang tidak tersedia buat sementara waktu. Cuba lagi kemudian.", securityNote: "Pertanyaan dihadkan kadarnya, diperiksa untuk penyalahgunaan automatik dan disimpan untuk susulan Axora yang dibenarkan. Jangan masukkan kata laluan atau pautan jemputan.", validationNote: "Medan disahkan sebelum dihantar." },
  footer: { summary: "Penyelarasan perolehan selamat dan berasaskan peranan daripada permintaan kepada rekod disahkan.", product: "Produk", company: "Syarikat", legal: "Perundangan", privacy: "Privasi", terms: "Terma", rights: "Hak cipta terpelihara." },
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

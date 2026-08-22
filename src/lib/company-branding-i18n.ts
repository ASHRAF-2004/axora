import type { SupportedLocale } from "./i18n";
import type {
  CompanyBrandWorkflowStatus,
  CompanyLogoQualityWarning,
} from "./tenant-branding";

export interface CompanyBrandingMessages {
  eyebrow: string;
  title: string;
  description: string;
  openReview: string;
  back: string;
  draft: string;
  published: string;
  notPublished: string;
  version: string;
  algorithm: string;
  sourceHash: string;
  workflow: string;
  previewTitle: string;
  previewHelp: string;
  desktop: string;
  tablet: string;
  mobile: string;
  light: string;
  dark: string;
  previewLanguage: string;
  device: string;
  appearance: string;
  hover: string;
  activeState: string;
  link: string;
  focus: string;
  replaceTitle: string;
  replaceHelp: string;
  chooseLogo: string;
  generateDraft: string;
  paletteTitle: string;
  paletteHelp: string;
  palette: string;
  reversed: string;
  vivid: string;
  safeDefault: string;
  createAlternative: string;
  editTitle: string;
  editHelp: string;
  primary: string;
  secondary: string;
  accent: string;
  pageBackground: string;
  darkBackground: string;
  text: string;
  inverseText: string;
  icon: string;
  inverseIcon: string;
  logoVariant: string;
  original: string;
  monochrome: string;
  inverted: string;
  logoPlacement: string;
  headerStart: string;
  headerCenter: string;
  preferredAppearance: string;
  saveDraft: string;
  reviewTitle: string;
  approve: string;
  reject: string;
  publish: string;
  rollback: string;
  reason: string;
  publishPermission: string;
  noPublishPermission: string;
  contrastTitle: string;
  contrastHelp: string;
  pass: string;
  fail: string;
  blocked: string;
  qualityTitle: string;
  qualityClear: string;
  quality: Record<CompanyLogoQualityWarning, string>;
  historyTitle: string;
  eventHistory: string;
  by: string;
  system: string;
  status: Record<CompanyBrandWorkflowStatus, string>;
  eventStatus: Record<CompanyBrandEventStatus, string>;
  notices: Record<string, string>;
}

export type CompanyBrandEventStatus =
  | "LOGO_UPLOADED"
  | "ANALYSIS_QUEUED"
  | "DRAFT_GENERATED"
  | CompanyBrandWorkflowStatus;

export interface CompanyBrandPreviewCopy {
  navigation: string[];
  eyebrow: string;
  heading: string;
  body: string;
  action: string;
  requests: string;
  budget: string;
  activity: string;
  available: string;
  reserved: string;
  submitted: string;
  approved: string;
}

const en: CompanyBrandingMessages = {
  eyebrow: "Company portal governance",
  title: "Brand and page review",
  description: "Review deterministic logo analysis and a safe component preview before anything reaches the company portal.",
  openReview: "Review brand and page",
  back: "Back to companies",
  draft: "Review draft",
  published: "Published theme",
  notPublished: "No company theme is published yet.",
  version: "Version",
  algorithm: "Algorithm",
  sourceHash: "Source logo hash",
  workflow: "Workflow state",
  previewTitle: "Controlled company page preview",
  previewHelp: "Preview the same safe components on each supported device, language direction, and appearance.",
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
  light: "Light",
  dark: "Dark",
  previewLanguage: "Preview language",
  device: "Preview device",
  appearance: "Preview appearance",
  hover: "Hover",
  activeState: "Active",
  link: "Link",
  focus: "Focus indicator",
  replaceTitle: "Replace logo and regenerate",
  replaceHelp: "The current published theme remains unchanged while the replacement draft is reviewed.",
  chooseLogo: "Choose approved logo",
  generateDraft: "Generate review draft",
  paletteTitle: "Controlled alternatives",
  paletteHelp: "Create another immutable draft from the same logo. The previous draft remains in history.",
  palette: "Alternative palette",
  reversed: "Reverse primary and secondary",
  vivid: "Use accent as secondary",
  safeDefault: "Use Axora accessible default",
  createAlternative: "Create alternative draft",
  editTitle: "Reviewed token adjustments",
  editHelp: "Axora reviewers may adjust bounded color and logo tokens. Contrast is recalculated and unsafe drafts cannot be approved.",
  primary: "Primary",
  secondary: "Secondary",
  accent: "Accent",
  pageBackground: "Light page background",
  darkBackground: "Dark page background",
  text: "Light-theme text",
  inverseText: "Dark-theme text",
  icon: "Light-theme icon",
  inverseIcon: "Dark-theme icon",
  logoVariant: "Logo variant",
  original: "Original",
  monochrome: "Monochrome",
  inverted: "Inverted",
  logoPlacement: "Logo placement",
  headerStart: "Header start",
  headerCenter: "Header center",
  preferredAppearance: "Published appearance",
  saveDraft: "Save reviewed draft",
  reviewTitle: "Human review decision",
  approve: "Approve draft",
  reject: "Reject draft",
  publish: "Publish approved version",
  rollback: "Publish rollback as a new version",
  reason: "Decision reason",
  publishPermission: "You have permission to publish an approved version.",
  noPublishPermission: "You may preview and review drafts, but publication requires delegated company.portal.publish permission.",
  contrastTitle: "WCAG contrast evidence",
  contrastHelp: "Text targets require 4.5:1; icons and focus indicators require 3:1.",
  pass: "Pass",
  fail: "Fail",
  blocked: "Approval and publication are blocked until every required contrast check passes.",
  qualityTitle: "Logo analysis warnings",
  qualityClear: "No logo quality warnings were detected.",
  quality: {
    LOW_RESOLUTION: "The source is low resolution and may appear soft on large screens.",
    TRANSPARENCY: "The source uses transparency. Check it on both light and dark backgrounds.",
    MONOCHROME: "The source has a limited palette. Controlled supporting colors were generated.",
    FALLBACK_PALETTE: "No usable non-white opaque color was found, so the accessible Axora palette was used.",
  },
  historyTitle: "Immutable versions",
  eventHistory: "Append-only workflow evidence",
  by: "by",
  system: "System",
  status: {
    REVIEW_REQUIRED: "Review required",
    APPROVED: "Approved",
    PUBLISHED: "Published",
    REJECTED: "Rejected",
    SUPERSEDED: "Superseded",
  },
  eventStatus: {
    LOGO_UPLOADED: "Logo uploaded",
    ANALYSIS_QUEUED: "Analysis queued",
    DRAFT_GENERATED: "Draft generated",
    REVIEW_REQUIRED: "Review required",
    APPROVED: "Approved",
    PUBLISHED: "Published",
    REJECTED: "Rejected",
    SUPERSEDED: "Superseded",
  },
  notices: {
    "draft-generated": "A new unpublished review draft was generated.",
    "alternative-generated": "The controlled alternative was saved as a new review draft.",
    "draft-adjusted": "The reviewed adjustments were saved as a new immutable draft.",
    approved: "The draft was approved. It is not published yet.",
    rejected: "The draft was rejected and remains in immutable history.",
    published: "The approved company theme was published.",
    rolledback: "The selected version was published as a new rollback version.",
    "contrast-blocked": "The decision was blocked because required contrast checks failed.",
    "invalid-state": "The workflow changed before this action completed. Review the current state.",
  },
};

const ar: CompanyBrandingMessages = {
  eyebrow: "حوكمة بوابة الشركة",
  title: "مراجعة الهوية والصفحة",
  description: "راجع تحليل الشعار الحتمي ومعاينة المكونات الآمنة قبل نشر أي شيء في بوابة الشركة.",
  openReview: "مراجعة الهوية والصفحة",
  back: "العودة إلى الشركات",
  draft: "مسودة المراجعة",
  published: "السمة المنشورة",
  notPublished: "لا توجد سمة منشورة للشركة بعد.",
  version: "الإصدار",
  algorithm: "الخوارزمية",
  sourceHash: "بصمة الشعار المصدر",
  workflow: "حالة سير العمل",
  previewTitle: "معاينة صفحة الشركة المنضبطة",
  previewHelp: "عاين المكونات الآمنة نفسها على كل جهاز واتجاه لغة ومظهر مدعوم.",
  desktop: "سطح المكتب",
  tablet: "الجهاز اللوحي",
  mobile: "الهاتف",
  light: "فاتح",
  dark: "داكن",
  previewLanguage: "لغة المعاينة",
  device: "جهاز المعاينة",
  appearance: "مظهر المعاينة",
  hover: "التحويم",
  activeState: "النشط",
  link: "الرابط",
  focus: "مؤشر التركيز",
  replaceTitle: "استبدال الشعار وإعادة التوليد",
  replaceHelp: "تبقى السمة المنشورة الحالية دون تغيير أثناء مراجعة المسودة البديلة.",
  chooseLogo: "اختيار الشعار المعتمد",
  generateDraft: "توليد مسودة للمراجعة",
  paletteTitle: "بدائل منضبطة",
  paletteHelp: "أنشئ مسودة ثابتة أخرى من الشعار نفسه. تبقى المسودة السابقة في السجل.",
  palette: "لوحة ألوان بديلة",
  reversed: "عكس اللونين الأساسي والثانوي",
  vivid: "استخدام لون التمييز كلون ثانوي",
  safeDefault: "استخدام إعداد Axora الافتراضي الميسر",
  createAlternative: "إنشاء مسودة بديلة",
  editTitle: "تعديلات الرموز الخاضعة للمراجعة",
  editHelp: "يمكن لمراجعي Axora تعديل رموز ألوان وشعار محدودة. يعاد حساب التباين ولا يمكن اعتماد المسودات غير الآمنة.",
  primary: "الأساسي",
  secondary: "الثانوي",
  accent: "التمييز",
  pageBackground: "خلفية الصفحة الفاتحة",
  darkBackground: "خلفية الصفحة الداكنة",
  text: "نص المظهر الفاتح",
  inverseText: "نص المظهر الداكن",
  icon: "أيقونة المظهر الفاتح",
  inverseIcon: "أيقونة المظهر الداكن",
  logoVariant: "نسخة الشعار",
  original: "الأصلية",
  monochrome: "أحادية اللون",
  inverted: "معكوسة",
  logoPlacement: "موضع الشعار",
  headerStart: "بداية الرأس",
  headerCenter: "منتصف الرأس",
  preferredAppearance: "المظهر المنشور",
  saveDraft: "حفظ المسودة المراجعة",
  reviewTitle: "قرار المراجعة البشرية",
  approve: "اعتماد المسودة",
  reject: "رفض المسودة",
  publish: "نشر الإصدار المعتمد",
  rollback: "نشر التراجع كإصدار جديد",
  reason: "سبب القرار",
  publishPermission: "لديك صلاحية نشر إصدار معتمد.",
  noPublishPermission: "يمكنك المعاينة والمراجعة، لكن النشر يتطلب صلاحية company.portal.publish مفوضة.",
  contrastTitle: "دليل تباين WCAG",
  contrastHelp: "يتطلب النص 4.5:1، وتتطلب الأيقونات ومؤشرات التركيز 3:1.",
  pass: "ناجح",
  fail: "غير ناجح",
  blocked: "يمنع الاعتماد والنشر حتى تنجح جميع اختبارات التباين المطلوبة.",
  qualityTitle: "تحذيرات تحليل الشعار",
  qualityClear: "لم تكتشف تحذيرات في جودة الشعار.",
  quality: {
    LOW_RESOLUTION: "دقة المصدر منخفضة وقد يبدو غير واضح على الشاشات الكبيرة.",
    TRANSPARENCY: "يستخدم المصدر الشفافية. افحصه على الخلفيتين الفاتحة والداكنة.",
    MONOCHROME: "لوحة المصدر محدودة. ولدت ألوان مساندة منضبطة.",
    FALLBACK_PALETTE: "لم يوجد لون معتم صالح غير الأبيض، لذلك استخدمت لوحة Axora الميسرة.",
  },
  historyTitle: "الإصدارات غير القابلة للتعديل",
  eventHistory: "دليل سير العمل المتتابع",
  by: "بواسطة",
  system: "النظام",
  status: {
    REVIEW_REQUIRED: "المراجعة مطلوبة",
    APPROVED: "معتمد",
    PUBLISHED: "منشور",
    REJECTED: "مرفوض",
    SUPERSEDED: "مستبدل",
  },
  eventStatus: {
    LOGO_UPLOADED: "تم رفع الشعار",
    ANALYSIS_QUEUED: "التحليل في قائمة الانتظار",
    DRAFT_GENERATED: "تم توليد المسودة",
    REVIEW_REQUIRED: "المراجعة مطلوبة",
    APPROVED: "معتمد",
    PUBLISHED: "منشور",
    REJECTED: "مرفوض",
    SUPERSEDED: "مستبدل",
  },
  notices: {
    "draft-generated": "تم توليد مسودة مراجعة جديدة غير منشورة.",
    "alternative-generated": "حفظ البديل المنضبط كمسودة مراجعة جديدة.",
    "draft-adjusted": "حفظت التعديلات المراجعة كمسودة ثابتة جديدة.",
    approved: "اعتمدت المسودة ولم تنشر بعد.",
    rejected: "رفضت المسودة وبقيت في السجل الثابت.",
    published: "نشرت سمة الشركة المعتمدة.",
    rolledback: "نشر الإصدار المحدد كإصدار تراجع جديد.",
    "contrast-blocked": "منع القرار بسبب فشل اختبارات التباين المطلوبة.",
    "invalid-state": "تغير سير العمل قبل اكتمال الإجراء. راجع الحالة الحالية.",
  },
};

const ms: CompanyBrandingMessages = {
  eyebrow: "Tadbir urus portal syarikat",
  title: "Semakan jenama dan halaman",
  description: "Semak analisis logo berketentuan dan pratonton komponen selamat sebelum apa-apa diterbitkan ke portal syarikat.",
  openReview: "Semak jenama dan halaman",
  back: "Kembali ke syarikat",
  draft: "Draf semakan",
  published: "Tema diterbitkan",
  notPublished: "Belum ada tema syarikat yang diterbitkan.",
  version: "Versi",
  algorithm: "Algoritma",
  sourceHash: "Cincangan logo sumber",
  workflow: "Status aliran kerja",
  previewTitle: "Pratonton halaman syarikat terkawal",
  previewHelp: "Pratonton komponen selamat yang sama pada setiap peranti, arah bahasa dan penampilan yang disokong.",
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mudah alih",
  light: "Cerah",
  dark: "Gelap",
  previewLanguage: "Bahasa pratonton",
  device: "Peranti pratonton",
  appearance: "Penampilan pratonton",
  hover: "Tuding",
  activeState: "Aktif",
  link: "Pautan",
  focus: "Penunjuk fokus",
  replaceTitle: "Ganti logo dan jana semula",
  replaceHelp: "Tema semasa yang diterbitkan kekal tanpa perubahan semasa draf gantian disemak.",
  chooseLogo: "Pilih logo diluluskan",
  generateDraft: "Jana draf semakan",
  paletteTitle: "Alternatif terkawal",
  paletteHelp: "Cipta satu lagi draf kekal daripada logo yang sama. Draf sebelumnya kekal dalam sejarah.",
  palette: "Palet alternatif",
  reversed: "Songsangkan warna utama dan sekunder",
  vivid: "Gunakan aksen sebagai sekunder",
  safeDefault: "Gunakan lalai Axora yang mudah dicapai",
  createAlternative: "Cipta draf alternatif",
  editTitle: "Pelarasan token yang disemak",
  editHelp: "Penyemak Axora boleh melaras token warna dan logo yang terbatas. Kontras dikira semula dan draf tidak selamat tidak boleh diluluskan.",
  primary: "Utama",
  secondary: "Sekunder",
  accent: "Aksen",
  pageBackground: "Latar halaman cerah",
  darkBackground: "Latar halaman gelap",
  text: "Teks tema cerah",
  inverseText: "Teks tema gelap",
  icon: "Ikon tema cerah",
  inverseIcon: "Ikon tema gelap",
  logoVariant: "Varian logo",
  original: "Asal",
  monochrome: "Monokrom",
  inverted: "Terbalik",
  logoPlacement: "Kedudukan logo",
  headerStart: "Mula pengepala",
  headerCenter: "Tengah pengepala",
  preferredAppearance: "Penampilan diterbitkan",
  saveDraft: "Simpan draf disemak",
  reviewTitle: "Keputusan semakan manusia",
  approve: "Luluskan draf",
  reject: "Tolak draf",
  publish: "Terbitkan versi diluluskan",
  rollback: "Terbitkan undur sebagai versi baharu",
  reason: "Sebab keputusan",
  publishPermission: "Anda mempunyai kebenaran untuk menerbitkan versi diluluskan.",
  noPublishPermission: "Anda boleh pratonton dan menyemak draf, tetapi penerbitan memerlukan kebenaran company.portal.publish yang diwakilkan.",
  contrastTitle: "Bukti kontras WCAG",
  contrastHelp: "Teks memerlukan 4.5:1; ikon dan penunjuk fokus memerlukan 3:1.",
  pass: "Lulus",
  fail: "Gagal",
  blocked: "Kelulusan dan penerbitan disekat sehingga semua semakan kontras yang diperlukan lulus.",
  qualityTitle: "Amaran analisis logo",
  qualityClear: "Tiada amaran kualiti logo dikesan.",
  quality: {
    LOW_RESOLUTION: "Sumber beresolusi rendah dan mungkin kelihatan kabur pada skrin besar.",
    TRANSPARENCY: "Sumber menggunakan ketelusan. Semak pada latar cerah dan gelap.",
    MONOCHROME: "Sumber mempunyai palet terhad. Warna sokongan terkawal telah dijana.",
    FALLBACK_PALETTE: "Tiada warna legap bukan putih yang sesuai, maka palet Axora mudah dicapai digunakan.",
  },
  historyTitle: "Versi kekal",
  eventHistory: "Bukti aliran kerja tambah sahaja",
  by: "oleh",
  system: "Sistem",
  status: {
    REVIEW_REQUIRED: "Semakan diperlukan",
    APPROVED: "Diluluskan",
    PUBLISHED: "Diterbitkan",
    REJECTED: "Ditolak",
    SUPERSEDED: "Diganti",
  },
  eventStatus: {
    LOGO_UPLOADED: "Logo dimuat naik",
    ANALYSIS_QUEUED: "Analisis dibariskan",
    DRAFT_GENERATED: "Draf dijana",
    REVIEW_REQUIRED: "Semakan diperlukan",
    APPROVED: "Diluluskan",
    PUBLISHED: "Diterbitkan",
    REJECTED: "Ditolak",
    SUPERSEDED: "Diganti",
  },
  notices: {
    "draft-generated": "Draf semakan baharu yang belum diterbitkan telah dijana.",
    "alternative-generated": "Alternatif terkawal disimpan sebagai draf semakan baharu.",
    "draft-adjusted": "Pelarasan yang disemak disimpan sebagai draf kekal baharu.",
    approved: "Draf diluluskan tetapi belum diterbitkan.",
    rejected: "Draf ditolak dan kekal dalam sejarah.",
    published: "Tema syarikat yang diluluskan telah diterbitkan.",
    rolledback: "Versi dipilih diterbitkan sebagai versi undur baharu.",
    "contrast-blocked": "Keputusan disekat kerana semakan kontras yang diperlukan gagal.",
    "invalid-state": "Aliran kerja berubah sebelum tindakan selesai. Semak status semasa.",
  },
};

const messages = { en, ar, ms } satisfies Record<
  SupportedLocale,
  CompanyBrandingMessages
>;

export function companyBrandingMessages(locale: SupportedLocale) {
  return messages[locale];
}

const previewMessages: Record<SupportedLocale, CompanyBrandPreviewCopy> = {
  en: {
    navigation: ["Home", "Requests", "Approvals"],
    eyebrow: "Company procurement",
    heading: "A clearer way to request what your teams need",
    body: "Create a request, follow approval, and see the budget impact in one place.",
    action: "Create request",
    requests: "Open requests",
    budget: "Monthly budget",
    activity: "Recent activity",
    available: "Available",
    reserved: "Reserved",
    submitted: "Submitted",
    approved: "Approved",
  },
  ar: {
    navigation: ["الرئيسية", "الطلبات", "الموافقات"],
    eyebrow: "مشتريات الشركة",
    heading: "طريقة أوضح لطلب احتياجات فرقك",
    body: "أنشئ طلباً وتابع الموافقة وشاهد أثر الميزانية في مكان واحد.",
    action: "إنشاء طلب",
    requests: "الطلبات المفتوحة",
    budget: "الميزانية الشهرية",
    activity: "النشاط الأخير",
    available: "متاح",
    reserved: "محجوز",
    submitted: "مرسل",
    approved: "معتمد",
  },
  ms: {
    navigation: ["Utama", "Permintaan", "Kelulusan"],
    eyebrow: "Perolehan syarikat",
    heading: "Cara lebih jelas untuk meminta keperluan pasukan",
    body: "Cipta permintaan, ikuti kelulusan dan lihat kesan bajet di satu tempat.",
    action: "Cipta permintaan",
    requests: "Permintaan terbuka",
    budget: "Bajet bulanan",
    activity: "Aktiviti terkini",
    available: "Tersedia",
    reserved: "Ditempah",
    submitted: "Dihantar",
    approved: "Diluluskan",
  },
};

export function companyBrandPreviewMessages(locale: SupportedLocale) {
  return previewMessages[locale];
}

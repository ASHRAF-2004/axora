import type { SupportedLocale } from "./i18n";

export interface PortalNavigationCopy {
  label: string;
  description?: string;
}

export interface PortalMessages {
  roles: Record<string, string>;
  navigation: Record<string, PortalNavigationCopy>;
  quickActions: {
    newRequest: string;
    addCompany: string;
    catalog: string;
  };
  shell: {
    skipToContent: string;
    openMenu: string;
    primaryNavigation: string;
    notifications: (count: number) => string;
    myProfile: string;
    accountSecurity: string;
    helpTutorial: string;
    signOut: string;
    language: string;
    workspace: string;
    menu: string;
    closeMenu: string;
    completeNavigation: string;
    groups: Record<string, string>;
    firstLogin: string;
    completeProfileTitle: string;
    completeProfileBody: string;
    completeProfileAction: string;
    signOutInstead: string;
    home: (brandName: string) => string;
  };
  tutorial: {
    open: string;
    restart: string;
    continue: string;
    roleGuide: string;
    close: string;
    stepOf: (current: number, total: number) => string;
    openArea: string;
    skipStep: string;
    previous: string;
    finish: string;
    understood: string;
  };
  environment: { production: string; sample: string };
}

const englishNavigation: Record<string, PortalNavigationCopy> = {
  "/dashboard": { label: "Dashboard" },
  "/driver": { label: "Delivery Guy assignments", description: "Buy items and complete assigned delivery evidence" },
  "/receiving": { label: "Receiving", description: "Independent line-by-line receipt confirmation" },
  "/products": { label: "Shopping", description: "Products and customer-facing images" },
  "/requests": { label: "Requests" },
  "/approvals": { label: "Approvals" },
  "/budgets": { label: "Budgets", description: "Authorization ledger, periods and reservations" },
  "/wallet": { label: "Company Wallet", description: "Actual funds, top-ups and immutable wallet evidence" },
  "/deliveries": { label: "Deliveries" },
  "/finance": { label: "Invoices" },
  "/companies": { label: "Companies", description: "Onboarding and tenant health" },
  "/branches": { label: "Branches & budgets", description: "Company structure and controls" },
  "/users": { label: "Axora Users", description: "Axora employees, roles and platform access" },
  "/company-users": { label: "Company Users", description: "Company employees, roles and scoped access" },
  "/reports": { label: "Reports", description: "Operational and company insights" },
  "/audit": { label: "Audit history", description: "Read-only evidence trail" },
  "/email-operations": { label: "Email operations", description: "Delivery, suppression and provider health" },
  "/support": { label: "Support diagnostics", description: "Audited system and account checks" },
  "/settings": { label: "Settings", description: "Personal and permitted administration" },
  "/settings/procurement": { label: "Purchasing rules", description: "Category policy by company, branch and department" },
  "/help": { label: "Help", description: "Guidance for your role" },
};

const english: PortalMessages = {
  roles: {
    ADMIN: "Company administrator", BRANCH_ADMIN: "Branch administrator",
    APPROVER: "Branch approver", REQUESTER: "Purchase requester",
    OPERATIONS: "Legacy operations", FINANCE: "Finance reviewer",
    VIEWER: "Read-only auditor", IT_SUPPORT: "Technical support",
    PLATFORM_OWNER: "Platform owner", HUMAN_RESOURCES_MANAGEMENT: "Human Resources Management", PLATFORM_OPERATIONS: "Axora operations administrator",
    CLIENT_ACCOUNT_MANAGER: "Client Account Manager (Agent)",
    COMPANY_ADMIN: "Company administrator", BRANCH_APPROVER: "Branch approver",
    COMPANY_APPROVER: "Company approver", FINANCE_REVIEWER: "Finance reviewer",
    AUDITOR: "Read-only auditor", TECHNICAL_SUPPORT: "Technical support",
    DELIVERY_DRIVER: "Legacy delivery assignment", DELIVERY_GUY: "Delivery Guy",
    RECEIVING_USER: "Receiving user", SCOPED_USER: "Scoped user",
  },
  navigation: englishNavigation,
  quickActions: { newRequest: "New request", addCompany: "Add company", catalog: "Catalog" },
  shell: {
    skipToContent: "Skip to main content",
    openMenu: "Open application menu", primaryNavigation: "Primary application navigation",
    notifications: (count) => `Notifications, ${count} unread`, myProfile: "My profile",
    accountSecurity: "Account & security", helpTutorial: "Help", signOut: "Sign out",
    language: "Language", workspace: "Axora workspace", menu: "Menu", closeMenu: "Close application menu",
    completeNavigation: "Complete application navigation",
    groups: { workspace: "Workspace", administration: "Administration", insight: "Insights & controls", support: "Support" },
    firstLogin: "First login · Required", completeProfileTitle: "Complete your profile first",
    completeProfileBody: "Confirm your identity, language, time zone, and notification preferences before starting work in Axora.",
    completeProfileAction: "Complete my profile", signOutInstead: "Sign out instead",
    home: (brandName) => `${brandName} home`,
  },
  tutorial: {
    open: "Open role tutorial", restart: "Restart tutorial", continue: "Continue tutorial",
    roleGuide: "Role guide", close: "Close tutorial and resume later",
    stepOf: (current, total) => `Step ${current} of ${total}`, openArea: "Open this area",
    skipStep: "Skip this step", previous: "Previous tutorial step", finish: "Finish", understood: "Got it",
  },
  environment: { production: "Production", sample: "Safe sample data" },
};

const arabic: PortalMessages = {
  roles: {
    ADMIN: "مدير الشركة", BRANCH_ADMIN: "مدير الفرع", APPROVER: "معتمد الفرع",
    REQUESTER: "مقدم طلب شراء", OPERATIONS: "عمليات قديمة", FINANCE: "مراجع مالي",
    VIEWER: "مدقق للقراءة فقط", IT_SUPPORT: "الدعم التقني", PLATFORM_OWNER: "مالك المنصة",
    HUMAN_RESOURCES_MANAGEMENT: "إدارة الموارد البشرية", CLIENT_ACCOUNT_MANAGER: "مدير حساب العميل",
    PLATFORM_OPERATIONS: "مدير عمليات أكسورا", COMPANY_ADMIN: "مدير الشركة",
    BRANCH_APPROVER: "معتمد الفرع", COMPANY_APPROVER: "معتمد الشركة",
    FINANCE_REVIEWER: "مراجع مالي", AUDITOR: "مدقق للقراءة فقط",
    TECHNICAL_SUPPORT: "الدعم التقني",
    DELIVERY_DRIVER: "سائق تسليم قديم", DELIVERY_GUY: "مسؤول التوصيل", RECEIVING_USER: "مستخدم الاستلام", SCOPED_USER: "مستخدم محدد النطاق",
  },
  navigation: {
    "/dashboard": { label: "لوحة التحكم" },
    "/driver": { label: "مهام السائق", description: "حالات وأدلة تسليم تتحمل ضعف الاتصال" },
    "/receiving": { label: "الاستلام", description: "تأكيد مستقل لكل بند مستلم" },
    "/products": { label: "التسوق", description: "المنتجات والصور الظاهرة للعملاء" },
    "/requests": { label: "الطلبات" }, "/approvals": { label: "الاعتمادات" },
    "/budgets": { label: "الميزانيات", description: "دفتر التفويض والفترات والحجوزات" },
    "/wallet": { label: "محفظة الشركة", description: "الأموال الفعلية وإضافات الرصيد وأدلة المحفظة غير القابلة للتغيير" },
    "/deliveries": { label: "عمليات التسليم" },
    "/finance": { label: "الفواتير" }, "/companies": { label: "الشركات", description: "تهيئة الشركات وصحتها" },
    "/branches": { label: "الفروع والميزانيات", description: "هيكل الشركة وضوابطها" },
    "/users": { label: "مستخدمو أكسورا", description: "موظفو أكسورا وأدوارهم ووصولهم إلى المنصة" },
    "/company-users": { label: "مستخدمو الشركة", description: "موظفو الشركة وأدوارهم ووصولهم محدد النطاق" },
    "/reports": { label: "التقارير", description: "مؤشرات العمليات والشركات" },
    "/audit": { label: "سجل التدقيق", description: "مسار أدلة للقراءة فقط" },
    "/email-operations": { label: "عمليات البريد", description: "التسليم والحظر وصحة مزود البريد" },
    "/support": { label: "تشخيص الدعم", description: "فحوصات مدققة للنظام والحسابات" },
    "/settings": { label: "الإعدادات", description: "الإعدادات الشخصية والإدارية المسموحة" },
    "/settings/procurement": { label: "قواعد الشراء", description: "سياسة الفئات حسب الشركة والفرع والقسم" },
    "/help": { label: "المساعدة", description: "إرشادات مخصصة لدورك" },
  },
  quickActions: { newRequest: "طلب جديد", addCompany: "إضافة شركة", catalog: "الكتالوج" },
  shell: {
    skipToContent: "تخطي إلى المحتوى الرئيسي",
    openMenu: "فتح قائمة التطبيق", primaryNavigation: "التنقل الرئيسي في التطبيق",
    notifications: (count) => `الإشعارات، ${count} غير مقروء`, myProfile: "ملفي الشخصي",
    accountSecurity: "الحساب والأمان", helpTutorial: "المساعدة", signOut: "تسجيل الخروج",
    language: "اللغة", workspace: "مساحة عمل أكسورا", menu: "القائمة", closeMenu: "إغلاق قائمة التطبيق",
    completeNavigation: "التنقل الكامل في التطبيق",
    groups: { workspace: "مساحة العمل", administration: "الإدارة", insight: "الرؤى والضوابط", support: "الدعم" },
    firstLogin: "الدخول الأول · مطلوب", completeProfileTitle: "أكمل ملفك الشخصي أولًا",
    completeProfileBody: "أكد هويتك ولغتك ومنطقتك الزمنية وتفضيلات الإشعارات قبل بدء العمل في أكسورا.",
    completeProfileAction: "إكمال ملفي الشخصي", signOutInstead: "تسجيل الخروج بدلًا من ذلك",
    home: (brandName) => `الصفحة الرئيسية لـ ${brandName}`,
  },
  tutorial: {
    open: "فتح دليل الدور", restart: "إعادة تشغيل الدليل", continue: "متابعة الدليل",
    roleGuide: "دليل الدور", close: "إغلاق الدليل ومتابعته لاحقًا",
    stepOf: (current, total) => `الخطوة ${current} من ${total}`, openArea: "فتح هذه الصفحة",
    skipStep: "تخطي هذه الخطوة", previous: "الخطوة السابقة", finish: "إنهاء", understood: "فهمت",
  },
  environment: { production: "الإنتاج", sample: "بيانات تجريبية آمنة" },
};

const malay: PortalMessages = {
  roles: {
    ADMIN: "Pentadbir syarikat", BRANCH_ADMIN: "Pentadbir cawangan", APPROVER: "Pelulus cawangan",
    REQUESTER: "Pemohon pembelian", OPERATIONS: "Operasi legasi", FINANCE: "Penyemak kewangan",
    VIEWER: "Juruaudit baca sahaja", IT_SUPPORT: "Sokongan teknikal", PLATFORM_OWNER: "Pemilik platform",
    HUMAN_RESOURCES_MANAGEMENT: "Pengurusan Sumber Manusia", CLIENT_ACCOUNT_MANAGER: "Pengurus Akaun Pelanggan",
    PLATFORM_OPERATIONS: "Pentadbir operasi Axora", COMPANY_ADMIN: "Pentadbir syarikat",
    BRANCH_APPROVER: "Pelulus cawangan", COMPANY_APPROVER: "Pelulus syarikat",
    FINANCE_REVIEWER: "Penyemak kewangan", AUDITOR: "Juruaudit baca sahaja",
    TECHNICAL_SUPPORT: "Sokongan teknikal",
    DELIVERY_DRIVER: "Pemandu penghantaran lama", DELIVERY_GUY: "Delivery Guy", RECEIVING_USER: "Pengguna penerimaan", SCOPED_USER: "Pengguna berskop",
  },
  navigation: {
    "/dashboard": { label: "Papan pemuka" },
    "/driver": { label: "Tugasan pemandu", description: "Status dan bukti penghantaran selamat luar talian" },
    "/receiving": { label: "Penerimaan", description: "Pengesahan resit bebas baris demi baris" },
    "/products": { label: "Membeli-belah", description: "Produk dan imej untuk pelanggan" },
    "/requests": { label: "Permintaan" }, "/approvals": { label: "Kelulusan" },
    "/budgets": { label: "Bajet", description: "Lejar kebenaran, tempoh dan rizab" },
    "/wallet": { label: "Dompet Syarikat", description: "Dana sebenar, tambah nilai dan bukti dompet kekal" },
    "/deliveries": { label: "Penghantaran" },
    "/finance": { label: "Invois" }, "/companies": { label: "Syarikat", description: "Penerimaan masuk dan kesihatan penyewa" },
    "/branches": { label: "Cawangan & bajet", description: "Struktur dan kawalan syarikat" },
    "/users": { label: "Pengguna Axora", description: "Pekerja Axora, peranan dan akses platform" },
    "/company-users": { label: "Pengguna Syarikat", description: "Pekerja syarikat, peranan dan akses berskop" },
    "/reports": { label: "Laporan", description: "Cerapan operasi dan syarikat" },
    "/audit": { label: "Sejarah audit", description: "Jejak bukti baca sahaja" },
    "/email-operations": { label: "Operasi e-mel", description: "Penghantaran, sekatan dan kesihatan penyedia" },
    "/support": { label: "Diagnostik sokongan", description: "Semakan sistem dan akaun yang diaudit" },
    "/settings": { label: "Tetapan", description: "Pentadbiran peribadi dan yang dibenarkan" },
    "/settings/procurement": { label: "Peraturan pembelian", description: "Polisi kategori mengikut syarikat, cawangan dan jabatan" },
    "/help": { label: "Bantuan", description: "Panduan untuk peranan anda" },
  },
  quickActions: { newRequest: "Permintaan baharu", addCompany: "Tambah syarikat", catalog: "Katalog" },
  shell: {
    skipToContent: "Langkau ke kandungan utama",
    openMenu: "Buka menu aplikasi", primaryNavigation: "Navigasi utama aplikasi",
    notifications: (count) => `Pemberitahuan, ${count} belum dibaca`, myProfile: "Profil saya",
    accountSecurity: "Akaun & keselamatan", helpTutorial: "Bantuan", signOut: "Log keluar",
    language: "Bahasa", workspace: "Ruang kerja Axora", menu: "Menu", closeMenu: "Tutup menu aplikasi",
    completeNavigation: "Navigasi lengkap aplikasi",
    groups: { workspace: "Ruang kerja", administration: "Pentadbiran", insight: "Cerapan & kawalan", support: "Sokongan" },
    firstLogin: "Log masuk pertama · Wajib", completeProfileTitle: "Lengkapkan profil anda dahulu",
    completeProfileBody: "Sahkan identiti, bahasa, zon waktu dan pilihan pemberitahuan sebelum mula bekerja dalam Axora.",
    completeProfileAction: "Lengkapkan profil saya", signOutInstead: "Log keluar sebaliknya",
    home: (brandName) => `Laman utama ${brandName}`,
  },
  tutorial: {
    open: "Buka tutorial peranan", restart: "Mulakan semula tutorial", continue: "Teruskan tutorial",
    roleGuide: "Panduan peranan", close: "Tutup tutorial dan sambung kemudian",
    stepOf: (current, total) => `Langkah ${current} daripada ${total}`, openArea: "Buka bahagian ini",
    skipStep: "Langkau langkah ini", previous: "Langkah tutorial sebelumnya", finish: "Selesai", understood: "Faham",
  },
  environment: { production: "Produksi", sample: "Data contoh selamat" },
};

export const PORTAL_MESSAGES: Record<SupportedLocale, PortalMessages> = { en: english, ar: arabic, ms: malay };

export function portalMessages(locale: SupportedLocale) {
  return PORTAL_MESSAGES[locale];
}

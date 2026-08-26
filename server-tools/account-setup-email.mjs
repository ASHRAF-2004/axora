import { readFile } from "node:fs/promises";

const TEMPLATE_URL = new URL("../email-templates/account-setup.html", import.meta.url);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_SETUP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REQUIRED_PLACEHOLDERS = [
  "EMAIL_LANG",
  "EMAIL_DIR",
  "EMAIL_TITLE",
  "PREHEADER",
  "GREETING",
  "ACCOUNT_READY",
  "CREATE_PASSWORD",
  "PRIVATE_LINK_PREFIX",
  "SIGN_IN_AS",
  "AFTER_CHOOSING_PASSWORD",
  "ACCOUNT_LABEL",
  "REPLY_LABEL",
  "WELCOME_TITLE",
  "PRODUCT_SUMMARY",
  "HELP_LABEL",
  "LOGIN_LABEL",
  "PRIVACY_LABEL",
  "INVITATION_CREATED_FOR",
  "USER_DISPLAY_NAME",
  "USER_EMAIL",
  "COMPANY_NAME",
  "ROLE_NAME",
  "BRANCH_NAME_BLOCK",
  "SETUP_URL",
  "EXPIRES_AT",
  "SUPPORT_EMAIL",
  "HELP_URL",
  "LOGIN_URL",
  "PRIVACY_URL",
  "CURRENT_YEAR",
];

let templatePromise;

const TRANSLATIONS = {
  en: {
    dir: "ltr",
    title: "Your Axora account is ready",
    subject: "Finish setting up your Axora account",
    greeting: "Hello",
    accountReady: "Your Axora account is ready.",
    createPassword: "Create my password",
    privateLinkPrefix: "Use this private, one-time link by",
    signInAs: "Sign in as",
    afterPassword: "after choosing your password.",
    accountLabel: "Account",
    replyLabel: "Reply",
    productSummary: "Axora keeps branches, budgets, purchase requests, approvals, and fulfilment together in one secure workspace.",
    helpLabel: "Contact",
    loginLabel: "Login",
    privacyLabel: "Privacy",
    invitationCreatedFor: "This invitation was created for",
    welcome: (company) => `Welcome to ${company} on Axora`,
    preheader: (company) => `Finish setting up your ${company} account on Axora.`,
    roleLine: "Role",
    emailLine: "Sign-in email",
    linkLine: (expiry) => `Create your password using this private, one-time link by ${expiry}:`,
    unexpected: "If you did not expect this invitation, do not use the link. Reply to this email for help.",
    helpLine: "Contact Axora",
    supportLine: "Support email",
    ownerWelcome: "Welcome to Axora",
    ownerPreheader: "Finish setting up your Axora platform owner account.",
  },
  ar: {
    dir: "rtl",
    title: "حسابك في Axora جاهز",
    subject: "أكمل إعداد حسابك في Axora",
    greeting: "مرحباً",
    accountReady: "حسابك في Axora جاهز.",
    createPassword: "إنشاء كلمة المرور",
    privateLinkPrefix: "استخدم هذا الرابط الخاص ولمرة واحدة قبل",
    signInAs: "سجّل الدخول بالبريد",
    afterPassword: "بعد اختيار كلمة المرور.",
    accountLabel: "الحساب",
    replyLabel: "الرد",
    productSummary: "تجمع Axora الفروع والميزانيات وطلبات الشراء والموافقات والتنفيذ في مساحة عمل آمنة واحدة.",
    helpLabel: "تواصل معنا",
    loginLabel: "تسجيل الدخول",
    privacyLabel: "الخصوصية",
    invitationCreatedFor: "تم إنشاء هذه الدعوة من أجل",
    welcome: (company) => `مرحباً بك في مساحة ${company} على Axora`,
    preheader: (company) => `أكمل إعداد حساب ${company} على Axora.`,
    roleLine: "الدور",
    emailLine: "بريد تسجيل الدخول",
    linkLine: (expiry) => `أنشئ كلمة المرور عبر هذا الرابط الخاص ولمرة واحدة قبل ${expiry}:`,
    unexpected: "إذا لم تكن تتوقع هذه الدعوة، فلا تستخدم الرابط. يمكنك الرد على هذه الرسالة للحصول على المساعدة.",
    helpLine: "تواصل مع Axora",
    supportLine: "بريد الدعم",
    ownerWelcome: "مرحباً بك في Axora",
    ownerPreheader: "أكمل إعداد حساب مالك منصة Axora.",
  },
  ms: {
    dir: "ltr",
    title: "Akaun Axora anda sudah sedia",
    subject: "Selesaikan persediaan akaun Axora anda",
    greeting: "Hai",
    accountReady: "Akaun Axora anda sudah sedia.",
    createPassword: "Cipta kata laluan saya",
    privateLinkPrefix: "Gunakan pautan peribadi sekali guna ini sebelum",
    signInAs: "Log masuk sebagai",
    afterPassword: "selepas memilih kata laluan anda.",
    accountLabel: "Akaun",
    replyLabel: "Balas",
    productSummary: "Axora menyatukan cawangan, bajet, permintaan pembelian, kelulusan dan pemenuhan dalam satu ruang kerja yang selamat.",
    helpLabel: "Hubungi kami",
    loginLabel: "Log masuk",
    privacyLabel: "Privasi",
    invitationCreatedFor: "Jemputan ini dicipta untuk",
    welcome: (company) => `Selamat datang ke ${company} di Axora`,
    preheader: (company) => `Selesaikan persediaan akaun ${company} anda di Axora.`,
    roleLine: "Peranan",
    emailLine: "E-mel log masuk",
    linkLine: (expiry) => `Cipta kata laluan anda melalui pautan peribadi sekali guna ini sebelum ${expiry}:`,
    unexpected: "Jika anda tidak menjangkakan jemputan ini, jangan gunakan pautan tersebut. Balas e-mel ini untuk mendapatkan bantuan.",
    helpLine: "Hubungi Axora",
    supportLine: "E-mel sokongan",
    ownerWelcome: "Selamat datang ke Axora",
    ownerPreheader: "Selesaikan persediaan akaun pemilik platform Axora anda.",
  },
};

const ROLE_LABELS = {
  en: {
    PLATFORM_OWNER: "Axora platform owner",
    HUMAN_RESOURCES_MANAGEMENT: "Human Resources Management",
    PLATFORM_OPERATIONS: "Axora operations administrator",
    CLIENT_ACCOUNT_MANAGER: "Client account manager",
    COMPANY_ADMIN: "Company administrator",
    BRANCH_ADMIN: "Branch administrator",
    DEPARTMENT_ADMIN: "Department administrator",
    BRANCH_APPROVER: "Branch approver",
    COMPANY_APPROVER: "Company approver",
    REQUESTER: "Purchase requester",
    FINANCE_REVIEWER: "Finance reviewer",
    AUDITOR: "Read-only auditor",
    TECHNICAL_SUPPORT: "Technical support",
    SUPPLIER_USER: "Supplier user",
    DELIVERY_TEAM_SUPERVISOR: "Delivery team supervisor",
    DELIVERY_AGENT: "Delivery Agent",
    DELIVERY_DRIVER: "Delivery driver",
    DELIVERY_GUY: "Delivery Agent",
    RECEIVING_USER: "Receiving user",
    ADMIN: "Company administrator",
    APPROVER: "Branch approver",
    OPERATIONS: "Purchase requester",
    FINANCE: "Finance reviewer",
    VIEWER: "Read-only auditor",
    IT_SUPPORT: "Technical support",
  },
  ar: {
    PLATFORM_OWNER: "مالك منصة Axora",
    HUMAN_RESOURCES_MANAGEMENT: "إدارة الموارد البشرية",
    PLATFORM_OPERATIONS: "مدير عمليات Axora",
    CLIENT_ACCOUNT_MANAGER: "مدير حسابات العملاء",
    COMPANY_ADMIN: "مدير الشركة",
    BRANCH_ADMIN: "مدير الفرع",
    DEPARTMENT_ADMIN: "مدير القسم",
    BRANCH_APPROVER: "معتمد الفرع",
    COMPANY_APPROVER: "معتمد الشركة",
    REQUESTER: "مقدم طلب شراء",
    FINANCE_REVIEWER: "مراجع مالي",
    AUDITOR: "مدقق للقراءة فقط",
    TECHNICAL_SUPPORT: "الدعم التقني",
    SUPPLIER_USER: "مستخدم المورد",
    DELIVERY_TEAM_SUPERVISOR: "مشرف فريق التوصيل",
    DELIVERY_AGENT: "مندوب التوصيل",
    DELIVERY_DRIVER: "سائق التسليم",
    DELIVERY_GUY: "مندوب التوصيل",
    RECEIVING_USER: "مستخدم الاستلام",
    ADMIN: "مدير الشركة",
    APPROVER: "معتمد الفرع",
    OPERATIONS: "مقدم طلب شراء",
    FINANCE: "مراجع مالي",
    VIEWER: "مدقق للقراءة فقط",
    IT_SUPPORT: "الدعم التقني",
  },
  ms: {
    PLATFORM_OWNER: "Pemilik platform Axora",
    HUMAN_RESOURCES_MANAGEMENT: "Pengurusan Sumber Manusia",
    PLATFORM_OPERATIONS: "Pentadbir operasi Axora",
    CLIENT_ACCOUNT_MANAGER: "Pengurus akaun pelanggan",
    COMPANY_ADMIN: "Pentadbir syarikat",
    BRANCH_ADMIN: "Pentadbir cawangan",
    DEPARTMENT_ADMIN: "Pentadbir jabatan",
    BRANCH_APPROVER: "Pelulus cawangan",
    COMPANY_APPROVER: "Pelulus syarikat",
    REQUESTER: "Pemohon pembelian",
    FINANCE_REVIEWER: "Penyemak kewangan",
    AUDITOR: "Juruaudit baca sahaja",
    TECHNICAL_SUPPORT: "Sokongan teknikal",
    SUPPLIER_USER: "Pengguna pembekal",
    DELIVERY_TEAM_SUPERVISOR: "Penyelia pasukan penghantaran",
    DELIVERY_AGENT: "Ejen penghantaran",
    DELIVERY_DRIVER: "Pemandu penghantaran",
    DELIVERY_GUY: "Petugas penghantaran",
    RECEIVING_USER: "Pengguna penerimaan",
    ADMIN: "Pentadbir syarikat",
    APPROVER: "Pelulus cawangan",
    OPERATIONS: "Pemohon pembelian",
    FINANCE: "Penyemak kewangan",
    VIEWER: "Juruaudit baca sahaja",
    IT_SUPPORT: "Sokongan teknikal",
  },
};

function templateSource() {
  templatePromise ??= readFile(TEMPLATE_URL, "utf8");
  return templatePromise;
}

function boundedText(value, label, maximum = 200) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function emailAddress(value, label) {
  const normalized = boundedText(value, label, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(normalized) || /[\r\n]/.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function secureApplicationUrl(value, label, appBaseUrl, options = {}) {
  let parsed;
  let base;
  try {
    parsed = new URL(String(value));
    base = new URL(String(appBaseUrl));
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (parsed.protocol !== "https:" || base.protocol !== "https:" || parsed.origin !== base.origin
    || parsed.username || parsed.password || base.username || base.password
    || base.pathname !== "/" || base.search || base.hash) {
    throw new Error(`${label} must use the configured Axora HTTPS origin.`);
  }
  if (options.accountSetup) {
    const fragment = new URLSearchParams(parsed.hash.slice(1));
    if (parsed.pathname !== "/account/setup" || parsed.search
      || fragment.size !== 1
      || !ACCOUNT_SETUP_TOKEN_PATTERN.test(fragment.get("token") ?? "")) {
      throw new Error(`${label} must be a valid private Axora setup link.`);
    }
  } else if (parsed.search || parsed.hash) {
    throw new Error(`${label} must use the configured Axora HTTPS origin.`);
  }
  return parsed.toString();
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatExpiry(value, locale) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invitation expiry is invalid.");
  const regionalLocale = { en: "en-MY", ar: "ar-MY", ms: "ms-MY" }[locale];
  return new Intl.DateTimeFormat(regionalLocale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function roleLabel(role, locale) {
  const labels = ROLE_LABELS[locale];
  const label = labels[role];
  if (!label) throw new Error("Invitation role is invalid.");
  return label;
}

function applyPlaceholders(template, values) {
  let html = template;
  for (const placeholder of REQUIRED_PLACEHOLDERS) {
    const marker = `{{${placeholder}}}`;
    if (!html.includes(marker)) throw new Error(`Email template is missing ${marker}.`);
    html = html.replaceAll(marker, values[placeholder]);
  }
  const unresolved = html.match(/{{[A-Z0-9_]+}}/g);
  if (unresolved) throw new Error(`Email template contains unresolved placeholders: ${unresolved.join(", ")}.`);
  return html;
}

export async function renderAccountSetupEmail(input, options = {}) {
  const appBaseUrl = secureApplicationUrl(
    options.appBaseUrl ?? process.env.APP_BASE_URL ?? "https://axora.management",
    "Application URL",
    options.appBaseUrl ?? process.env.APP_BASE_URL ?? "https://axora.management",
  );
  const recipientName = boundedText(input.recipientName, "Recipient name");
  const recipientEmail = emailAddress(input.recipientEmail, "Recipient email");
  const companyName = boundedText(input.companyName, "Company name");
  const supportEmail = emailAddress(options.supportEmail ?? "support@axora.management", "Support email");
  const locale = input.locale === undefined ? "en" : String(input.locale).toLowerCase();
  const copy = TRANSLATIONS[locale];
  if (!copy) throw new Error("Invitation locale is invalid.");
  const setupUrl = secureApplicationUrl(input.setupUrl, "Account setup URL", appBaseUrl, {
    accountSetup: true,
  });
  const loginUrl = secureApplicationUrl(new URL("/login", appBaseUrl), "Login URL", appBaseUrl);
  const helpUrl = secureApplicationUrl(new URL(`/${locale}/contact`, appBaseUrl), "Contact URL", appBaseUrl);
  const privacyUrl = secureApplicationUrl(new URL(`/${locale}/privacy`, appBaseUrl), "Privacy URL", appBaseUrl);
  const branchName = input.branchName ? boundedText(input.branchName, "Branch name") : "";
  const expiresAt = formatExpiry(input.expiresAt, locale);
  const role = roleLabel(input.role, locale);
  const isPlatformOwner = input.role === "PLATFORM_OWNER";
  const preheader = isPlatformOwner
    ? copy.ownerPreheader
    : copy.preheader(companyName);
  const values = {
    EMAIL_LANG: locale,
    EMAIL_DIR: copy.dir,
    EMAIL_TITLE: escapeHtml(copy.title),
    PREHEADER: escapeHtml(preheader),
    GREETING: escapeHtml(copy.greeting),
    ACCOUNT_READY: escapeHtml(copy.accountReady),
    CREATE_PASSWORD: escapeHtml(copy.createPassword),
    PRIVATE_LINK_PREFIX: escapeHtml(copy.privateLinkPrefix),
    SIGN_IN_AS: escapeHtml(copy.signInAs),
    AFTER_CHOOSING_PASSWORD: escapeHtml(copy.afterPassword),
    ACCOUNT_LABEL: escapeHtml(copy.accountLabel),
    REPLY_LABEL: escapeHtml(copy.replyLabel),
    WELCOME_TITLE: escapeHtml(
      isPlatformOwner ? copy.ownerWelcome : copy.welcome(companyName),
    ),
    PRODUCT_SUMMARY: escapeHtml(copy.productSummary),
    HELP_LABEL: escapeHtml(copy.helpLabel),
    LOGIN_LABEL: escapeHtml(copy.loginLabel),
    PRIVACY_LABEL: escapeHtml(copy.privacyLabel),
    INVITATION_CREATED_FOR: escapeHtml(copy.invitationCreatedFor),
    USER_DISPLAY_NAME: escapeHtml(recipientName),
    USER_EMAIL: escapeHtml(recipientEmail),
    COMPANY_NAME: escapeHtml(isPlatformOwner ? "Axora" : companyName),
    ROLE_NAME: escapeHtml(role),
    BRANCH_NAME_BLOCK: branchName
      ? `<br><span style="color:#526b80">${escapeHtml(branchName)}</span>`
      : "",
    SETUP_URL: escapeHtml(setupUrl),
    EXPIRES_AT: escapeHtml(expiresAt),
    SUPPORT_EMAIL: escapeHtml(supportEmail),
    HELP_URL: escapeHtml(helpUrl),
    LOGIN_URL: escapeHtml(loginUrl),
    PRIVACY_URL: escapeHtml(privacyUrl),
    CURRENT_YEAR: String(new Date().getUTCFullYear()),
  };
  const template = options.template ?? await templateSource();
  const html = applyPlaceholders(template, values);
  const subject = copy.subject;
  const text = [
    `${copy.greeting} ${recipientName},`,
    "",
    isPlatformOwner ? copy.ownerWelcome : copy.welcome(companyName),
    `${copy.roleLine}: ${role}${branchName ? ` (${branchName})` : ""}`,
    `${copy.emailLine}: ${recipientEmail}`,
    "",
    copy.linkLine(expiresAt),
    setupUrl,
    "",
    copy.unexpected,
    `${copy.helpLine}: ${helpUrl}`,
    `${copy.loginLabel}: ${loginUrl}`,
    `${copy.privacyLabel}: ${privacyUrl}`,
    `${copy.supportLine}: ${supportEmail}`,
  ].join("\n");
  return { subject, html, text, recipientName, recipientEmail, supportEmail };
}

export const accountSetupEmailInternals = {
  requiredPlaceholders: [...REQUIRED_PLACEHOLDERS],
};

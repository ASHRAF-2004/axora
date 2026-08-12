import { readFile } from "node:fs/promises";
import { resolveEmailTemplate } from "./email-template-catalogue.mjs";

const TEMPLATE_URL = new URL("../email-templates/transactional.html", import.meta.url);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLACEHOLDERS = [
  "EMAIL_LANG", "EMAIL_DIR", "TEXT_ALIGN", "PREHEADER", "EYEBROW",
  "EMAIL_TITLE", "INTRO", "DETAILS_BLOCK", "MESSAGE_BLOCK", "ACTION_BLOCK",
  "SECURITY_NOTE", "HELP_TEXT", "CURRENT_YEAR", "FOOTER_TEXT",
];
const COPY = {
  en: {
    dir: "ltr", align: "left", locale: "en", supportLabel: "Axora support",
    contact: {
      eyebrow: "New website enquiry", title: "A company contacted Axora",
      intro: "A validated enquiry was recorded through the Axora website.",
      subject: "New Axora website enquiry",
      labels: { name: "Name", email: "Email", company: "Company", phone: "Phone", submitted: "Submitted", subject: "Subject" },
      message: "Message", security: "The sender accepted the contact privacy notice and passed the configured Turnstile verification before this record was created.",
      help: "Reply to this email to respond directly to the sender.", footer: "Private contact notification.",
    },
    acknowledgement: {
      eyebrow: "Company enquiry received", title: "We received your enquiry",
      intro: "Your company enquiry has been recorded securely for review by the Axora team.",
      subject: "We received your Axora company enquiry",
      labels: { company: "Company", subject: "Enquiry", submitted: "Received" },
      security: "This acknowledgement confirms receipt only. It does not confirm company acceptance, account creation, or access approval.",
      help: "If you did not submit this enquiry, contact Axora support.", footer: "Company enquiry acknowledgement.",
    },
    reset: {
      eyebrow: "Account security", title: "Reset your Axora password",
      intro: "We received a request to choose a new password for your Axora account.",
      subject: "Reset your Axora password", action: "Choose a new password",
      labels: { account: "Account", expires: "Link expires" },
      security: "This private link works once. If you did not request a password reset, ignore this email; your current password remains unchanged.",
      help: "Axora will never ask you to send your password by email.", footer: "Secure account notification.",
    },
    passwordChanged: {
      eyebrow: "Account security", title: "Your Axora password was changed",
      intro: "The password for your Axora account was changed successfully and prior sessions were ended.",
      subject: "Your Axora password was changed", labels: { account: "Account" },
      security: "If you did not make this change, contact Axora support immediately. Never send your password by email.",
      help: "Sign in again with your new password.", footer: "Secure account notification.",
    },
    verify: {
      eyebrow: "Account verification", title: "Verify your email address",
      intro: "Confirm that this email address belongs to your Axora account.",
      subject: "Verify your Axora email address", action: "Verify email address",
      labels: { account: "Account", expires: "Link expires" },
      security: "This private link works once. If you did not request it, ignore this email and contact your administrator if needed.",
      help: "No account information changes until the verification link is used.", footer: "Secure account notification.",
    },
    workflow: {
      eyebrow: "Procurement update", title: "There is an update in Axora",
      intro: "A procurement workflow relevant to your role has been updated.",
      subject: "Axora workflow update", action: "Open Axora",
      labels: { update: "Update" },
      security: "Sign in to Axora to review the complete record. This email contains no password, setup token, or private supplier document.",
      help: "You can change routine workflow email delivery from your notification settings.",
      footer: "Role-aware workflow notification.",
    },
  },
  ar: {
    dir: "rtl", align: "right", locale: "ar", supportLabel: "دعم Axora",
    contact: {
      eyebrow: "استفسار جديد من الموقع", title: "تواصلت شركة مع Axora",
      intro: "تم تسجيل استفسار موثّق عبر موقع Axora.",
      subject: "استفسار جديد عبر موقع Axora",
      labels: { name: "الاسم", email: "البريد", company: "الشركة", phone: "الهاتف", submitted: "وقت الإرسال", subject: "الموضوع" },
      message: "الرسالة", security: "وافق المرسل على إشعار خصوصية التواصل واجتاز تحقق Turnstile قبل إنشاء هذا السجل.",
      help: "استخدم الرد على هذه الرسالة للتواصل مباشرة مع المرسل.", footer: "إشعار تواصل خاص.",
    },
    acknowledgement: {
      eyebrow: "تم استلام استفسار الشركة", title: "استلمنا استفسارك",
      intro: "تم تسجيل استفسار شركتك بأمان لمراجعته من فريق Axora.",
      subject: "استلمنا استفسار شركتك لدى Axora",
      labels: { company: "الشركة", subject: "الاستفسار", submitted: "وقت الاستلام" },
      security: "يؤكد هذا الإشعار الاستلام فقط، ولا يعني قبول الشركة أو إنشاء حساب أو الموافقة على الوصول.",
      help: "إذا لم ترسل هذا الاستفسار، فتواصل مع دعم Axora.", footer: "إشعار استلام استفسار شركة.",
    },
    reset: {
      eyebrow: "أمان الحساب", title: "إعادة تعيين كلمة مرور Axora",
      intro: "تلقينا طلباً لاختيار كلمة مرور جديدة لحسابك في Axora.",
      subject: "إعادة تعيين كلمة مرور Axora", action: "اختيار كلمة مرور جديدة",
      labels: { account: "الحساب", expires: "انتهاء صلاحية الرابط" },
      security: "يعمل هذا الرابط الخاص مرة واحدة. إذا لم تطلب إعادة التعيين فتجاهل الرسالة؛ ستبقى كلمة مرورك الحالية دون تغيير.",
      help: "لن تطلب منك Axora إرسال كلمة مرورك عبر البريد.", footer: "إشعار آمن للحساب.",
    },
    passwordChanged: {
      eyebrow: "أمان الحساب", title: "تم تغيير كلمة مرور Axora",
      intro: "تم تغيير كلمة مرور حسابك في Axora بنجاح وإنهاء الجلسات السابقة.",
      subject: "تم تغيير كلمة مرور Axora", labels: { account: "الحساب" },
      security: "إذا لم تُجرِ هذا التغيير، فتواصل مع دعم Axora فورًا. لا ترسل كلمة مرورك عبر البريد.",
      help: "سجّل الدخول مجددًا بكلمة المرور الجديدة.", footer: "إشعار آمن للحساب.",
    },
    verify: {
      eyebrow: "توثيق الحساب", title: "توثيق عنوان بريدك الإلكتروني",
      intro: "أكّد أن عنوان البريد هذا يخص حسابك في Axora.",
      subject: "توثيق بريد حساب Axora", action: "توثيق البريد الإلكتروني",
      labels: { account: "الحساب", expires: "انتهاء صلاحية الرابط" },
      security: "يعمل هذا الرابط الخاص مرة واحدة. إذا لم تطلبه فتجاهل الرسالة وتواصل مع مسؤولك عند الحاجة.",
      help: "لن تتغير معلومات الحساب قبل استخدام رابط التوثيق.", footer: "إشعار آمن للحساب.",
    },
    workflow: {
      eyebrow: "تحديث المشتريات", title: "يوجد تحديث في Axora",
      intro: "تم تحديث إجراء مشتريات مرتبط بدورك.",
      subject: "تحديث إجراء في Axora", action: "فتح Axora",
      labels: { update: "التحديث" },
      security: "سجّل الدخول إلى Axora لمراجعة السجل الكامل. لا تحتوي هذه الرسالة على كلمة مرور أو رمز إعداد أو مستند مورّد خاص.",
      help: "يمكنك تغيير توقيت رسائل الإجراءات المعتادة من إعدادات الإشعارات.",
      footer: "إشعار إجراء مرتبط بالدور.",
    },
  },
  ms: {
    dir: "ltr", align: "left", locale: "ms-MY", supportLabel: "Sokongan Axora",
    contact: {
      eyebrow: "Pertanyaan laman web baharu", title: "Sebuah syarikat menghubungi Axora",
      intro: "Pertanyaan yang disahkan telah direkodkan melalui laman web Axora.",
      subject: "Pertanyaan laman web Axora baharu",
      labels: { name: "Nama", email: "E-mel", company: "Syarikat", phone: "Telefon", submitted: "Dihantar", subject: "Subjek" },
      message: "Mesej", security: "Pengirim menerima notis privasi hubungan dan lulus pengesahan Turnstile sebelum rekod ini dibuat.",
      help: "Balas e-mel ini untuk memberi respons terus kepada pengirim.", footer: "Pemberitahuan hubungan peribadi.",
    },
    acknowledgement: {
      eyebrow: "Pertanyaan syarikat diterima", title: "Kami menerima pertanyaan anda",
      intro: "Pertanyaan syarikat anda telah direkodkan dengan selamat untuk semakan pasukan Axora.",
      subject: "Kami menerima pertanyaan syarikat Axora anda",
      labels: { company: "Syarikat", subject: "Pertanyaan", submitted: "Diterima" },
      security: "Pengakuan ini hanya mengesahkan penerimaan. Ia tidak mengesahkan penerimaan syarikat, penciptaan akaun atau kelulusan akses.",
      help: "Jika anda tidak menghantar pertanyaan ini, hubungi sokongan Axora.", footer: "Pengakuan pertanyaan syarikat.",
    },
    reset: {
      eyebrow: "Keselamatan akaun", title: "Tetapkan semula kata laluan Axora anda",
      intro: "Kami menerima permintaan untuk memilih kata laluan baharu bagi akaun Axora anda.",
      subject: "Tetapkan semula kata laluan Axora anda", action: "Pilih kata laluan baharu",
      labels: { account: "Akaun", expires: "Pautan tamat tempoh" },
      security: "Pautan peribadi ini berfungsi sekali. Jika anda tidak meminta tetapan semula, abaikan e-mel ini; kata laluan semasa kekal sama.",
      help: "Axora tidak akan meminta anda menghantar kata laluan melalui e-mel.", footer: "Pemberitahuan akaun selamat.",
    },
    passwordChanged: {
      eyebrow: "Keselamatan akaun", title: "Kata laluan Axora anda telah diubah",
      intro: "Kata laluan akaun Axora anda berjaya diubah dan sesi terdahulu telah ditamatkan.",
      subject: "Kata laluan Axora anda telah diubah", labels: { account: "Akaun" },
      security: "Jika anda tidak membuat perubahan ini, hubungi sokongan Axora dengan segera. Jangan hantar kata laluan melalui e-mel.",
      help: "Log masuk semula dengan kata laluan baharu anda.", footer: "Pemberitahuan akaun selamat.",
    },
    verify: {
      eyebrow: "Pengesahan akaun", title: "Sahkan alamat e-mel anda",
      intro: "Sahkan bahawa alamat e-mel ini milik akaun Axora anda.",
      subject: "Sahkan alamat e-mel Axora anda", action: "Sahkan alamat e-mel",
      labels: { account: "Akaun", expires: "Pautan tamat tempoh" },
      security: "Pautan peribadi ini berfungsi sekali. Jika anda tidak memintanya, abaikan e-mel ini dan hubungi pentadbir jika perlu.",
      help: "Maklumat akaun tidak berubah sehingga pautan pengesahan digunakan.", footer: "Pemberitahuan akaun selamat.",
    },
    workflow: {
      eyebrow: "Kemas kini perolehan", title: "Terdapat kemas kini dalam Axora",
      intro: "Aliran kerja perolehan yang berkaitan dengan peranan anda telah dikemas kini.",
      subject: "Kemas kini aliran kerja Axora", action: "Buka Axora",
      labels: { update: "Kemas kini" },
      security: "Log masuk ke Axora untuk menyemak rekod lengkap. E-mel ini tidak mengandungi kata laluan, token persediaan atau dokumen pembekal peribadi.",
      help: "Anda boleh mengubah masa penghantaran e-mel aliran kerja rutin dalam tetapan pemberitahuan.",
      footer: "Pemberitahuan aliran kerja mengikut peranan.",
    },
  },
};

const INVOICE_COPY = {
  en: {
    eyebrow: "Invoice", title: "Payment confirmed",
    intro: "Your payment has been recorded successfully. Your finalized invoice is attached for your records.",
    subject: "Your Axora invoice",
    labels: { invoice: "Invoice", reference: "Reference", status: "Status", amount: "Amount paid", paidAt: "Paid" },
    paid: "Paid", security: "The attached PDF is the finalized invoice for this payment.",
    help: "Keep this email and attachment for your records.", footer: "Finalized invoice notification.",
  },
  ar: {
    eyebrow: "الفاتورة", title: "تم تأكيد الدفع",
    intro: "تم تسجيل دفعتك بنجاح. الفاتورة النهائية مرفقة لسجلاتك.",
    subject: "فاتورة Axora الخاصة بك",
    labels: { invoice: "الفاتورة", reference: "المرجع", status: "الحالة", amount: "المبلغ المدفوع", paidAt: "وقت الدفع" },
    paid: "مدفوع", security: "ملف PDF المرفق هو الفاتورة النهائية لهذا الدفع.",
    help: "احتفظ بهذه الرسالة والمرفق لسجلاتك.", footer: "إشعار الفاتورة النهائية.",
  },
  ms: {
    eyebrow: "Invois", title: "Bayaran disahkan",
    intro: "Bayaran anda telah direkodkan. Invois muktamad dilampirkan untuk rekod anda.",
    subject: "Invois Axora anda",
    labels: { invoice: "Invois", reference: "Rujukan", status: "Status", amount: "Jumlah dibayar", paidAt: "Dibayar" },
    paid: "Dibayar", security: "PDF yang dilampirkan ialah invois muktamad untuk bayaran ini.",
    help: "Simpan e-mel dan lampiran ini untuk rekod anda.", footer: "Pemberitahuan invois muktamad.",
  },
};

let templatePromise;

function templateSource() {
  templatePromise ??= readFile(TEMPLATE_URL, "utf8");
  return templatePromise;
}

export function escapeTransactionalEmailHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function boundedText(value, label, maximum = 200, minimum = 1) {
  const normalized = String(value ?? "").trim();
  if (normalized.length < minimum || normalized.length > maximum
    || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function boundedMultilineText(value, label, maximum, minimum) {
  const normalized = String(value ?? "").trim();
  if (normalized.length < minimum || normalized.length > maximum
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
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

function formatDate(value, locale) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Email date is invalid.");
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  }).format(date);
}

function actionUrl(value, kind, appBaseUrl) {
  let url;
  let base;
  try {
    url = new URL(String(value));
    base = new URL(String(appBaseUrl));
  } catch {
    throw new Error("Security action URL is invalid.");
  }
  const expectedPath = kind === "PASSWORD_RESET"
    ? "/account/reset-password"
    : "/account/verify-email";
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (base.protocol !== "https:" || base.pathname !== "/" || base.search || base.hash
    || base.username || base.password || url.origin !== base.origin
    || url.pathname !== expectedPath || url.search || url.username || url.password
    || fragment.size !== 1 || !TOKEN_PATTERN.test(fragment.get("token") ?? "")) {
    throw new Error("Security action URL is invalid.");
  }
  return url.toString();
}

function workflowActionUrl(value, appBaseUrl) {
  const path = String(value ?? "/notifications");
  if (path.length > 500 || !path.startsWith("/") || path.startsWith("//")
    || path.includes("://") || path.includes("#")
    || /[\u0000-\u001F\u007F]/.test(path)) {
    throw new Error("Workflow action path is invalid.");
  }
  let base;
  let url;
  try {
    base = new URL(String(appBaseUrl));
    url = new URL(path, base);
  } catch {
    throw new Error("Workflow action path is invalid.");
  }
  if (base.protocol !== "https:" || base.pathname !== "/" || base.search
    || base.hash || base.username || base.password || url.origin !== base.origin
    || url.username || url.password) {
    throw new Error("Workflow action path is invalid.");
  }
  return url.toString();
}

function detailRows(entries, textAlign) {
  return `<table role="presentation" width="100%" style="width:100%;border:1px solid #d9e5ee">${entries.map(([label, value]) => `<tr><td class="detail-label" width="34%" valign="top" style="width:34%;padding:11px 14px;border-bottom:1px solid #e7eef4;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;font-weight:700;color:#0f3156;text-align:${textAlign}">${escapeTransactionalEmailHtml(label)}</td><td class="detail-value" valign="top" style="padding:11px 14px;border-bottom:1px solid #e7eef4;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#304b65;text-align:${textAlign};word-break:break-word">${escapeTransactionalEmailHtml(value)}</td></tr>`).join("")}</table>`;
}

function actionBlock(url, label) {
  const safeUrl = escapeTransactionalEmailHtml(url);
  const safeLabel = escapeTransactionalEmailHtml(label);
  return `<div style="padding-top:28px"><!--[if mso]><v:roundrect href="${safeUrl}" style="height:48px;v-text-anchor:middle;width:360px" arcsize="8%" stroke="f" fillcolor="#0f3156"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold">${safeLabel}</center></v:roundrect><![endif]--><!--[if !mso]><!--><table role="presentation" width="360" class="action" style="width:360px;max-width:100%"><tr><td align="center" bgcolor="#0f3156" style="border-radius:4px"><a href="${safeUrl}" target="_blank" style="display:block;padding:14px 20px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;font-weight:700;text-decoration:none">${safeLabel}</a></td></tr></table><!--<![endif]--></div>`;
}

function applyPlaceholders(template, values) {
  let html = template;
  for (const key of PLACEHOLDERS) {
    const marker = `{{${key}}}`;
    if (!html.includes(marker)) throw new Error(`Transactional email template is missing ${marker}.`);
    html = html.replaceAll(marker, values[key]);
  }
  if (/{{[A-Z0-9_]+}}/.test(html)) throw new Error("Transactional email template has unresolved placeholders.");
  return html;
}

export async function renderTransactionalEmail(input, options = {}) {
  if (!UUID_PATTERN.test(String(input.deliveryId ?? ""))) {
    throw new Error("Transactional delivery identifier is invalid.");
  }
  const locale = String(input.locale ?? "en").toLowerCase();
  const copy = COPY[locale];
  if (!copy) throw new Error("Transactional email locale is invalid.");
  const templateDefinition = resolveEmailTemplate(input);
  const recipientEmail = emailAddress(input.recipientEmail, "Recipient email");
  const recipientName = boundedText(input.recipientName, "Recipient name");
  const appBaseUrl = options.appBaseUrl ?? "https://axora.management";
  let kindCopy;
  let subject;
  let preheader;
  let details;
  let messageBlock = "";
  let action = "";
  const supportEmail = emailAddress(options.supportEmail ?? "support@axora.management", "Support email");
  let replyToEmail = supportEmail;
  let replyToName = "Axora support";
  let helpText;
  let text;

  if (input.messageKind === "CONTACT_ACKNOWLEDGEMENT") {
    const contact = input.contact ?? {};
    const company = boundedText(contact.company, "Company name");
    const enquirySubject = boundedText(contact.subject, "Contact subject");
    const submitted = formatDate(contact.submittedAt, copy.locale);
    kindCopy = copy.acknowledgement;
    subject = kindCopy.subject;
    preheader = kindCopy.intro;
    details = detailRows([
      [kindCopy.labels.company, company],
      [kindCopy.labels.subject, enquirySubject],
      [kindCopy.labels.submitted, submitted],
    ], copy.align);
    helpText = `${kindCopy.help} ${copy.supportLabel}: ${supportEmail}`;
    text = `${kindCopy.title}\n\n${kindCopy.intro}\n\n${kindCopy.labels.company}: ${company}\n${kindCopy.labels.subject}: ${enquirySubject}\n${kindCopy.labels.submitted}: ${submitted}\n\n${kindCopy.security}\n${helpText}`;
  } else if (input.messageKind === "CONTACT_NOTIFICATION") {
    const contact = input.contact ?? {};
    const name = boundedText(contact.name, "Contact name");
    const email = emailAddress(contact.email, "Contact email");
    const company = boundedText(contact.company, "Company name");
    const phone = contact.phone ? boundedText(contact.phone, "Phone", 40) : undefined;
    const enquirySubject = boundedText(contact.subject, "Contact subject");
    const message = boundedMultilineText(contact.message, "Contact message", 5_000, 10);
    const submitted = formatDate(contact.submittedAt, copy.locale);
    kindCopy = copy.contact;
    subject = kindCopy.subject;
    preheader = kindCopy.intro;
    details = detailRows([
      [kindCopy.labels.name, name], [kindCopy.labels.email, email],
      [kindCopy.labels.company, company],
      ...(phone ? [[kindCopy.labels.phone, phone]] : []),
      [kindCopy.labels.subject, enquirySubject], [kindCopy.labels.submitted, submitted],
    ], copy.align);
    messageBlock = `<div style="margin-top:20px;padding:18px 20px;background:#f3f8fc;font-family:Arial,Helvetica,sans-serif;color:#304b65;text-align:${copy.align}"><strong style="display:block;margin-bottom:8px;color:#0f3156">${escapeTransactionalEmailHtml(kindCopy.message)}</strong><p style="margin:0;font-size:14px;line-height:23px;white-space:normal">${escapeTransactionalEmailHtml(message).replaceAll(/\r?\n/g, "<br>")}</p></div>`;
    replyToEmail = email;
    replyToName = name;
    helpText = `${kindCopy.help} ${copy.supportLabel}: ${supportEmail}`;
    text = `${kindCopy.title}\n\n${kindCopy.labels.name}: ${name}\n${kindCopy.labels.email}: ${email}\n${kindCopy.labels.company}: ${company}${phone ? `\n${kindCopy.labels.phone}: ${phone}` : ""}\n${kindCopy.labels.subject}: ${enquirySubject}\n${kindCopy.labels.submitted}: ${submitted}\n\n${kindCopy.message}:\n${message}\n\n${kindCopy.security}\n${helpText}`;
  } else if (input.messageKind === "INVOICE_FINALIZED") {
    const invoice = input.invoice ?? {};
    const invoiceNumber = boundedText(invoice.invoiceNumber, "Invoice number", 100);
    const requestReference = boundedText(invoice.requestReference, "Request reference", 100);
    const amount = boundedText(`${invoice.currency} ${invoice.amount}`, "Invoice amount", 80);
    const paidAt = formatDate(invoice.paidAt, copy.locale);
    kindCopy = INVOICE_COPY[locale];
    subject = `${kindCopy.subject} ${invoiceNumber}`;
    preheader = kindCopy.intro;
    details = detailRows([
      [kindCopy.labels.invoice, invoiceNumber],
      [kindCopy.labels.reference, requestReference],
      [kindCopy.labels.status, kindCopy.paid],
      [kindCopy.labels.amount, amount],
      [kindCopy.labels.paidAt, paidAt],
    ], copy.align);
    helpText = `${kindCopy.help} ${copy.supportLabel}: ${supportEmail}`;
    text = `${kindCopy.title}\n\n${kindCopy.intro}\n\n${kindCopy.labels.invoice}: ${invoiceNumber}\n${kindCopy.labels.reference}: ${requestReference}\n${kindCopy.labels.status}: ${kindCopy.paid}\n${kindCopy.labels.amount}: ${amount}\n${kindCopy.labels.paidAt}: ${paidAt}\n\n${kindCopy.security}\n${helpText}`;
  } else if (input.messageKind === "PASSWORD_CHANGED") {
    kindCopy = copy.passwordChanged;
    subject = kindCopy.subject;
    preheader = kindCopy.intro;
    details = detailRows([[kindCopy.labels.account, recipientEmail]], copy.align);
    helpText = `${kindCopy.help} ${copy.supportLabel}: ${supportEmail}`;
    text = `${kindCopy.title}\n\n${kindCopy.intro}\n\n${kindCopy.labels.account}: ${recipientEmail}\n\n${kindCopy.security}\n${helpText}`;
  } else if (["PASSWORD_RESET", "EMAIL_VERIFICATION"].includes(input.messageKind)) {
    const expires = formatDate(input.expiresAt, copy.locale);
    const url = actionUrl(input.actionUrl, input.messageKind, appBaseUrl);
    kindCopy = input.messageKind === "PASSWORD_RESET" ? copy.reset : copy.verify;
    subject = kindCopy.subject;
    preheader = kindCopy.intro;
    details = detailRows([
      [kindCopy.labels.account, recipientEmail],
      [kindCopy.labels.expires, expires],
    ], copy.align);
    action = actionBlock(url, kindCopy.action);
    helpText = `${kindCopy.help} ${copy.supportLabel}: ${supportEmail}`;
    text = `${kindCopy.title}\n\n${kindCopy.intro}\n\n${kindCopy.labels.account}: ${recipientEmail}\n${kindCopy.labels.expires}: ${expires}\n\n${kindCopy.action}:\n${url}\n\n${kindCopy.security}\n${helpText}`;
  } else if (input.messageKind === "WORKFLOW_UPDATE") {
    const workflow = input.workflow ?? {};
    const updateTitle = boundedText(workflow.title, "Workflow update title", 180);
    const updateBody = boundedMultilineText(
      workflow.body,
      "Workflow update body",
      2_000,
      1,
    );
    const url = workflowActionUrl(workflow.actionPath, appBaseUrl);
    kindCopy = copy.workflow;
    subject = kindCopy.subject;
    preheader = kindCopy.intro;
    details = detailRows([[kindCopy.labels.update, updateTitle]], copy.align);
    messageBlock = `<div style="margin-top:20px;padding:18px 20px;background:#f3f8fc;font-family:Arial,Helvetica,sans-serif;color:#304b65;text-align:${copy.align}"><p style="margin:0;font-size:14px;line-height:23px;white-space:normal">${escapeTransactionalEmailHtml(updateBody).replaceAll(/\r?\n/g, "<br>")}</p></div>`;
    action = actionBlock(url, kindCopy.action);
    helpText = `${kindCopy.help} ${copy.supportLabel}: ${supportEmail}`;
    text = `${kindCopy.title}\n\n${kindCopy.intro}\n\n${kindCopy.labels.update}: ${updateTitle}\n\n${updateBody}\n\n${kindCopy.action}:\n${url}\n\n${kindCopy.security}\n${helpText}`;
  } else {
    throw new Error("Transactional email kind is invalid.");
  }

  if (input.messageKind !== "INVOICE_FINALIZED") {
    subject = templateDefinition.subjects[locale];
  }

  const template = options.template ?? await templateSource();
  const html = applyPlaceholders(template, {
    EMAIL_LANG: locale,
    EMAIL_DIR: copy.dir,
    TEXT_ALIGN: copy.align,
    PREHEADER: escapeTransactionalEmailHtml(preheader),
    EYEBROW: escapeTransactionalEmailHtml(kindCopy.eyebrow),
    EMAIL_TITLE: escapeTransactionalEmailHtml(kindCopy.title),
    INTRO: escapeTransactionalEmailHtml(kindCopy.intro),
    DETAILS_BLOCK: details,
    MESSAGE_BLOCK: messageBlock,
    ACTION_BLOCK: action,
    SECURITY_NOTE: escapeTransactionalEmailHtml(kindCopy.security),
    HELP_TEXT: escapeTransactionalEmailHtml(helpText),
    CURRENT_YEAR: String(new Date().getUTCFullYear()),
    FOOTER_TEXT: escapeTransactionalEmailHtml(kindCopy.footer),
  });
  return {
    recipientEmail,
    recipientName,
    replyToEmail,
    replyToName,
    subject,
    html,
    text,
    templateKey: templateDefinition.key,
    templateVersion: templateDefinition.version,
    providerAgent: templateDefinition.agent,
    priority: templateDefinition.priority,
    tracking: templateDefinition.tracking,
  };
}

export const transactionalEmailRendererInternals = {
  placeholders: [...PLACEHOLDERS],
};

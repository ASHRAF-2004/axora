const LOCALES = Object.freeze(["en", "ar", "ms"]);
const AGENTS = Object.freeze([
  "axora-auth",
  "axora-procurement",
  "axora-budget",
  "axora-delivery",
  "axora-documents",
  "axora-platform",
]);

function definition(key, agent, priority, requiredVariables, subjects, options = {}) {
  return Object.freeze({
    key,
    version: 1,
    agent,
    priority,
    requiredVariables: Object.freeze(requiredVariables),
    supportedLocales: LOCALES,
    senderPolicy: agent === "axora-auth" ? "SECURITY" : "PURPOSE_AGENT",
    replyToPolicy: options.replyToPolicy ?? "MONITORED_SUPPORT",
    securitySensitivity: options.securitySensitivity ?? "OPERATIONAL",
    tracking: Object.freeze({ opens: false, clicks: false }),
    recipientPolicy: options.recipientPolicy ?? "CURRENT_AUTHORIZED_RECIPIENT",
    subjects: Object.freeze(subjects),
  });
}

const t = (key, agent, en, ar, ms, required = ["recipientName"]) => definition(
  key,
  agent,
  agent === "axora-auth" ? "URGENT"
    : agent === "axora-procurement" || agent === "axora-budget" ? "HIGH"
      : "NORMAL",
  required,
  { en, ar, ms },
  agent === "axora-auth" ? { securitySensitivity: "SECURITY" } : {},
);

export const EMAIL_TEMPLATE_CATALOGUE = Object.freeze({
  "company-admin-invitation": t("company-admin-invitation", "axora-auth", "Set up your Axora Company Administrator account", "إعداد حساب مسؤول الشركة في Axora", "Sediakan akaun Pentadbir Syarikat Axora anda", ["recipientName", "companyName", "actionUrl", "expiresAt"]),
  "internal-user-invitation": t("internal-user-invitation", "axora-auth", "Set up your Axora account", "إعداد حسابك في Axora", "Sediakan akaun Axora anda", ["recipientName", "actionUrl", "expiresAt"]),
  "account-activated": t("account-activated", "axora-auth", "Your Axora account is active", "حسابك في Axora نشط", "Akaun Axora anda aktif"),
  "email-verification": t("email-verification", "axora-auth", "Verify your Axora email address", "توثيق بريد حساب Axora", "Sahkan alamat e-mel Axora anda", ["recipientName", "actionUrl", "expiresAt"]),
  "password-reset": t("password-reset", "axora-auth", "Reset your Axora password", "إعادة تعيين كلمة مرور Axora", "Tetapkan semula kata laluan Axora anda", ["recipientName", "actionUrl", "expiresAt"]),
  "password-changed": t("password-changed", "axora-auth", "Your Axora password was changed", "تم تغيير كلمة مرور Axora", "Kata laluan Axora anda telah diubah"),
  "account-security-change": t("account-security-change", "axora-auth", "Security change on your Axora account", "تغيير أمني في حساب Axora", "Perubahan keselamatan pada akaun Axora anda"),

  "company-lead-acknowledgement": t("company-lead-acknowledgement", "axora-platform", "We received your Axora company enquiry", "استلمنا استفسار شركتك لدى Axora", "Kami menerima pertanyaan syarikat Axora anda", ["recipientName", "companyName"]),
  "contact-acknowledgement": t("contact-acknowledgement", "axora-platform", "We received your Axora company enquiry", "استلمنا استفسار شركتك لدى Axora", "Kami menerima pertanyaan syarikat Axora anda", ["recipientName", "companyName"]),
  "new-lead-internal-alert": t("new-lead-internal-alert", "axora-platform", "New Axora website enquiry", "استفسار جديد عبر موقع Axora", "Pertanyaan laman web Axora baharu", ["recipientName", "companyName"]),
  "contact-notification": t("contact-notification", "axora-platform", "New Axora website enquiry", "استفسار جديد عبر موقع Axora", "Pertanyaan laman web Axora baharu", ["recipientName", "companyName"]),
  "lead-assigned": t("lead-assigned", "axora-platform", "A company lead was assigned", "تم تعيين عميل محتمل", "Prospek syarikat telah ditugaskan"),
  "lead-reassigned": t("lead-reassigned", "axora-platform", "A company lead was reassigned", "تمت إعادة تعيين عميل محتمل", "Prospek syarikat telah ditugaskan semula"),
  "company-information-requested": t("company-information-requested", "axora-platform", "More company information is required", "معلومات إضافية عن الشركة مطلوبة", "Maklumat syarikat tambahan diperlukan"),
  "portal-ready-for-review": t("portal-ready-for-review", "axora-platform", "Your Axora portal is ready for review", "بوابة Axora جاهزة للمراجعة", "Portal Axora anda sedia untuk semakan"),
  "company-activated": t("company-activated", "axora-platform", "Your company is active on Axora", "شركتك نشطة على Axora", "Syarikat anda aktif di Axora"),
  "company-suspended": t("company-suspended", "axora-platform", "Your company access was suspended", "تم تعليق وصول شركتك", "Akses syarikat anda digantung"),

  "request-submitted": t("request-submitted", "axora-procurement", "Purchase request submitted", "تم إرسال طلب الشراء", "Permintaan pembelian dihantar", ["recipientName", "requestCode"]),
  "department-approval-required": t("department-approval-required", "axora-procurement", "Department approval required", "موافقة القسم مطلوبة", "Kelulusan jabatan diperlukan", ["recipientName", "requestCode"]),
  "company-approval-required": t("company-approval-required", "axora-procurement", "Company approval required", "موافقة الشركة مطلوبة", "Kelulusan syarikat diperlukan", ["recipientName", "requestCode"]),
  "axora-approval-required": t("axora-approval-required", "axora-procurement", "Axora approval required", "موافقة Axora مطلوبة", "Kelulusan Axora diperlukan", ["recipientName", "requestCode"]),
  "request-approved": t("request-approved", "axora-procurement", "Purchase request approved", "تمت الموافقة على طلب الشراء", "Permintaan pembelian diluluskan", ["recipientName", "requestCode"]),
  "request-rejected": t("request-rejected", "axora-procurement", "Purchase request rejected", "تم رفض طلب الشراء", "Permintaan pembelian ditolak", ["recipientName", "requestCode"]),
  "request-returned-for-changes": t("request-returned-for-changes", "axora-procurement", "Purchase request returned for changes", "أعيد طلب الشراء للتعديل", "Permintaan pembelian dikembalikan untuk perubahan", ["recipientName", "requestCode"]),
  "request-cancelled": t("request-cancelled", "axora-procurement", "Purchase request cancelled", "تم إلغاء طلب الشراء", "Permintaan pembelian dibatalkan", ["recipientName", "requestCode"]),
  "additional-actual-approval-required": t("additional-actual-approval-required", "axora-procurement", "Additional actual amount approval required", "موافقة مبلغ فعلي إضافي مطلوبة", "Kelulusan amaun sebenar tambahan diperlukan", ["recipientName", "requestCode"]),
  "budget-low": t("budget-low", "axora-budget", "Budget is running low", "الميزانية منخفضة", "Bajet semakin rendah"),
  "budget-zero": t("budget-zero", "axora-budget", "Budget has reached zero", "نفدت الميزانية", "Bajet telah mencapai sifar"),
  "budget-refreshed": t("budget-refreshed", "axora-budget", "Budget was refreshed", "تم تحديث الميزانية", "Bajet telah disegarkan"),
  "budget-refresh-failed": t("budget-refresh-failed", "axora-budget", "Budget refresh requires attention", "تحديث الميزانية يحتاج إلى متابعة", "Penyegaran bajet memerlukan perhatian"),

  "delivery-assignment-created": t("delivery-assignment-created", "axora-delivery", "Delivery assignment created", "تم إنشاء مهمة توصيل", "Tugasan penghantaran dibuat"),
  "delivery-agent-accepted": t("delivery-agent-accepted", "axora-delivery", "Delivery Agent accepted the assignment", "قبل مندوب التوصيل المهمة", "Ejen Penghantaran menerima tugasan"),
  "shopping-started": t("shopping-started", "axora-delivery", "Shopping started", "بدأ التسوق", "Pembelian bermula"),
  "items-acquired": t("items-acquired", "axora-delivery", "Items were acquired", "تم الحصول على المنتجات", "Item telah diperoleh"),
  "substitute-approval-required": t("substitute-approval-required", "axora-delivery", "Substitute approval required", "موافقة البديل مطلوبة", "Kelulusan pengganti diperlukan"),
  "out-for-delivery": t("out-for-delivery", "axora-delivery", "Order is out for delivery", "الطلب في طريقه للتوصيل", "Pesanan sedang dihantar"),
  "delivery-arrived": t("delivery-arrived", "axora-delivery", "Delivery has arrived", "وصلت عملية التوصيل", "Penghantaran telah tiba"),
  "failed-delivery-rescheduled": t("failed-delivery-rescheduled", "axora-delivery", "Delivery attempt requires rescheduling", "محاولة التوصيل تحتاج إلى إعادة جدولة", "Percubaan penghantaran perlu dijadualkan semula"),
  "delivery-completed": t("delivery-completed", "axora-delivery", "Delivery completed", "اكتمل التوصيل", "Penghantaran selesai"),

  "approved-request-pdf-available": t("approved-request-pdf-available", "axora-documents", "Approved Purchase Request PDF is available", "ملف PDF لطلب الشراء المعتمد متاح", "PDF Permintaan Pembelian yang diluluskan tersedia"),
  "final-delivery-pdf-available": t("final-delivery-pdf-available", "axora-documents", "Final fulfilment and delivery PDF is available", "ملف PDF النهائي للتجهيز والتوصيل متاح", "PDF pemenuhan dan penghantaran akhir tersedia"),
  "supplier-purchase-order-ready": t("supplier-purchase-order-ready", "axora-documents", "Supplier purchase order is ready", "أمر شراء المورد جاهز", "Pesanan pembelian pembekal sedia"),
  "workflow-update": t("workflow-update", "axora-platform", "Axora workflow update", "تحديث إجراء في Axora", "Kemas kini aliran kerja Axora"),
});

export function emailTemplateDefinition(key) {
  const value = EMAIL_TEMPLATE_CATALOGUE[key];
  if (!value) throw new Error("Transactional email template is not registered.");
  return value;
}

export function resolveEmailTemplate(input) {
  if (input?.templateKey) return emailTemplateDefinition(String(input.templateKey));
  const key = input?.messageKind === "CONTACT_NOTIFICATION" ? "contact-notification"
    : input?.messageKind === "CONTACT_ACKNOWLEDGEMENT" ? "contact-acknowledgement"
      : input?.messageKind === "PASSWORD_RESET" ? "password-reset"
        : input?.messageKind === "PASSWORD_CHANGED" ? "password-changed"
          : input?.messageKind === "EMAIL_VERIFICATION" ? "email-verification"
            : "workflow-update";
  return emailTemplateDefinition(key);
}

export const emailTemplateCatalogueInternals = { AGENTS, LOCALES };

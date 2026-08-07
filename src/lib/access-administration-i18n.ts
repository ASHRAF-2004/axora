import type { SupportedLocale } from "./i18n";
import type { RoleScopeType } from "./types";

interface AccessAdministrationMessages {
  openAccess: string;
  eyebrow: string;
  title: (name: string) => string;
  description: string;
  backToUsers: string;
  identity: string;
  account: string;
  jobTitle: string;
  assignment: string;
  assignments: string;
  assignmentsDescription: string;
  selected: string;
  manageable: string;
  viewOnly: string;
  permissions: string;
  permissionsDescription: string;
  permission: string;
  source: string;
  outcome: string;
  roleIncluded: string;
  roleNotIncluded: string;
  effective: string;
  notEffective: string;
  highRisk: string;
  standardRisk: string;
  applyOverride: string;
  applyOverrideDescription: string;
  effect: string;
  grant: string;
  deny: string;
  expiresAt: string;
  optional: string;
  reason: string;
  reasonPlaceholder: string;
  apply: string;
  applying: string;
  noManagePermission: string;
  overrides: string;
  overridesDescription: string;
  noOverrides: string;
  changedBy: string;
  period: string;
  noExpiry: string;
  remove: string;
  removing: string;
  removeReason: string;
  approvalLimits: string;
  approvalLimitsDescription: string;
  noApprovalLimits: string;
  amount: string;
  subject: string;
  userSubject: string;
  roleSubject: string;
  selfApproval: string;
  allowed: string;
  notAllowed: string;
  delegatedAccess: string;
  delegatedAccessDescription: string;
  noDelegations: string;
  authorizedBy: string;
  history: string;
  historyDescription: string;
  historyUnavailable: string;
  noHistory: string;
  occurredAt: string;
  platform: string;
  delivery: string;
  scopeTypes: Record<RoleScopeType, string>;
  notices: Record<string, string>;
  changeTypes: Record<string, string>;
}

const en: AccessAdministrationMessages = {
  openAccess: "Access",
  eyebrow: "People · Access administration",
  title: (name) => `${name}'s access`,
  description: "Review one live role assignment, its effective permissions, explicit grants or denials, approval limits, delegated authority, and scoped change history.",
  backToUsers: "Back to users",
  identity: "Account identity",
  account: "Account",
  jobTitle: "Job title",
  assignment: "Selected assignment",
  assignments: "Role assignments",
  assignmentsDescription: "Only active assignments within your current authorization scope are shown.",
  selected: "Selected",
  manageable: "Permission changes allowed",
  viewOnly: "View only",
  permissions: "Permission catalogue",
  permissionsDescription: "Effective means the selected assignment can currently use the permission after role grants, explicit denials, explicit grants, and live delegation are evaluated.",
  permission: "Permission",
  source: "Role source",
  outcome: "Effective outcome",
  roleIncluded: "Included by role",
  roleNotIncluded: "Not included by role",
  effective: "Effective",
  notEffective: "Not effective",
  highRisk: "High risk",
  standardRisk: "Standard",
  applyOverride: "Apply an explicit permission override",
  applyOverrideDescription: "The change is limited to the selected assignment scope. Explicit denial takes precedence over every grant.",
  effect: "Effect",
  grant: "Grant",
  deny: "Deny",
  expiresAt: "Expiry date and time",
  optional: "optional",
  reason: "Reason",
  reasonPlaceholder: "Explain the operational or security reason for this change",
  apply: "Apply override",
  applying: "Applying override…",
  noManagePermission: "You may review this assignment, but your current role cannot change its permissions.",
  overrides: "Active explicit overrides",
  overridesDescription: "Broader overrides that affect the selected scope are included. Remove is available only when you can manage the override's exact scope.",
  noOverrides: "No active explicit grants or denials affect this assignment.",
  changedBy: "Changed by",
  period: "Effective period",
  noExpiry: "No expiry",
  remove: "Remove override",
  removing: "Removing override…",
  removeReason: "Reason for removal",
  approvalLimits: "Approval limits",
  approvalLimitsDescription: "Financial approval authority is separate from permission access and remains subject to the selected scope.",
  noApprovalLimits: "No active approval limit affects this assignment.",
  amount: "Maximum amount",
  subject: "Subject",
  userSubject: "This user",
  roleSubject: "Assigned role",
  selfApproval: "Self approval",
  allowed: "Allowed",
  notAllowed: "Not allowed",
  delegatedAccess: "Delegated access",
  delegatedAccessDescription: "Temporary authority remains valid only while the original authorizer, direct permissions, assignments, and scopes remain active.",
  noDelegations: "No live delegated authority is bound to this assignment.",
  authorizedBy: "Authorized by",
  history: "Access change history",
  historyDescription: "The latest fifty visible changes are shown without credentials, tokens, raw network identifiers, or private identity hashes.",
  historyUnavailable: "Your current role does not include audit-history access for this scope.",
  noHistory: "No visible access changes were recorded for this scope.",
  occurredAt: "Occurred",
  platform: "Axora platform",
  delivery: "Delivery network",
  scopeTypes: {
    PLATFORM: "Platform",
    COMPANY: "Company",
    BRANCH: "Branch",
    DEPARTMENT: "Department",
    SUPPLIER: "Supplier",
    DELIVERY: "Delivery",
  },
  notices: {
    "override-applied": "The permission override was applied and the affected user's active sessions were invalidated.",
    "override-removed": "The permission override was removed and the affected user's active sessions were invalidated.",
    "change-unavailable": "The access change could not be completed. Refresh the page and verify that both assignments and scopes are still active.",
    "invalid-change": "The submitted permission, period, or reason is invalid.",
  },
  changeTypes: {
    PERMISSION_GRANTED: "Permission granted",
    PERMISSION_DENIED: "Permission denied",
    PERMISSION_REMOVED: "Permission override removed",
    APPROVAL_LIMIT_SET: "Approval limit set",
    APPROVAL_LIMIT_REMOVED: "Approval limit removed",
    DELEGATION_CREATED: "Delegated access created",
    DELEGATION_REVOKED: "Delegated access revoked",
    ROLE_ASSIGNED: "Role assigned",
    ROLE_REVOKED: "Role revoked",
  },
};

const ar: AccessAdministrationMessages = {
  ...en,
  openAccess: "الصلاحيات",
  eyebrow: "الأشخاص · إدارة الصلاحيات",
  title: (name) => `صلاحيات ${name}`,
  description: "راجع تعيين دور نشط واحد وصلاحياته الفعلية والمنح أو المنع الصريح وحدود الاعتماد والتفويض المؤقت وسجل التغييرات المقيّد بالنطاق.",
  backToUsers: "العودة إلى المستخدمين",
  identity: "هوية الحساب",
  account: "الحساب",
  jobTitle: "المسمى الوظيفي",
  assignment: "التعيين المحدد",
  assignments: "تعيينات الأدوار",
  assignmentsDescription: "تظهر فقط التعيينات النشطة الواقعة ضمن نطاق صلاحيتك الحالية.",
  selected: "محدد",
  manageable: "يمكن تغيير الصلاحيات",
  viewOnly: "للعرض فقط",
  permissions: "دليل الصلاحيات",
  permissionsDescription: "تعني «فعّالة» أن التعيين المحدد يستطيع استخدام الصلاحية حالياً بعد احتساب صلاحيات الدور والمنع والمنح الصريح والتفويض النشط.",
  permission: "الصلاحية",
  source: "مصدر الدور",
  outcome: "النتيجة الفعلية",
  roleIncluded: "مضمنة في الدور",
  roleNotIncluded: "غير مضمنة في الدور",
  effective: "فعّالة",
  notEffective: "غير فعّالة",
  highRisk: "عالية الخطورة",
  standardRisk: "عادية",
  applyOverride: "تطبيق استثناء صريح للصلاحية",
  applyOverrideDescription: "يقتصر التغيير على نطاق التعيين المحدد، ويكون للمنع الصريح أولوية على جميع المنح.",
  effect: "التأثير",
  grant: "منح",
  deny: "منع",
  expiresAt: "تاريخ ووقت الانتهاء",
  optional: "اختياري",
  reason: "السبب",
  reasonPlaceholder: "اشرح السبب التشغيلي أو الأمني لهذا التغيير",
  apply: "تطبيق الاستثناء",
  applying: "جارٍ تطبيق الاستثناء…",
  noManagePermission: "يمكنك مراجعة هذا التعيين، لكن دورك الحالي لا يسمح بتغيير صلاحياته.",
  overrides: "الاستثناءات الصريحة النشطة",
  overridesDescription: "تتضمن القائمة الاستثناءات الأوسع التي تؤثر في النطاق المحدد. لا يظهر زر الإزالة إلا عند امتلاك صلاحية إدارة النطاق الدقيق للاستثناء.",
  noOverrides: "لا يوجد منح أو منع صريح نشط يؤثر في هذا التعيين.",
  changedBy: "غيّرها",
  period: "فترة السريان",
  noExpiry: "دون انتهاء",
  remove: "إزالة الاستثناء",
  removing: "جارٍ إزالة الاستثناء…",
  removeReason: "سبب الإزالة",
  approvalLimits: "حدود الاعتماد",
  approvalLimitsDescription: "صلاحية الاعتماد المالي منفصلة عن صلاحية الوصول وتظل مقيّدة بالنطاق المحدد.",
  noApprovalLimits: "لا يوجد حد اعتماد نشط يؤثر في هذا التعيين.",
  amount: "الحد الأقصى",
  subject: "المستفيد",
  userSubject: "هذا المستخدم",
  roleSubject: "الدور المعيّن",
  selfApproval: "اعتماد الطلب الشخصي",
  allowed: "مسموح",
  notAllowed: "غير مسموح",
  delegatedAccess: "الصلاحيات المفوضة",
  delegatedAccessDescription: "يبقى التفويض المؤقت صالحاً فقط ما دام المفوِّض وصلاحياته المباشرة وتعييناته ونطاقاته نشطة.",
  noDelegations: "لا توجد صلاحية مفوضة نشطة مرتبطة بهذا التعيين.",
  authorizedBy: "فوّضها",
  history: "سجل تغييرات الصلاحيات",
  historyDescription: "تظهر أحدث خمسين عملية مسموحاً بعرضها دون كلمات مرور أو رموز أو معرّفات شبكة خام أو بصمات هوية خاصة.",
  historyUnavailable: "دورك الحالي لا يتضمن عرض سجل التدقيق لهذا النطاق.",
  noHistory: "لا توجد تغييرات صلاحيات ظاهرة مسجلة لهذا النطاق.",
  occurredAt: "وقت الحدث",
  platform: "منصة أكسورا",
  delivery: "شبكة التسليم",
  scopeTypes: {
    PLATFORM: "المنصة",
    COMPANY: "الشركة",
    BRANCH: "الفرع",
    DEPARTMENT: "القسم",
    SUPPLIER: "المورد",
    DELIVERY: "التسليم",
  },
  notices: {
    "override-applied": "تم تطبيق استثناء الصلاحية وإبطال الجلسات النشطة للمستخدم المتأثر.",
    "override-removed": "تمت إزالة استثناء الصلاحية وإبطال الجلسات النشطة للمستخدم المتأثر.",
    "change-unavailable": "تعذر إكمال تغيير الصلاحية. حدّث الصفحة وتأكد من أن التعيينات والنطاقات ما تزال نشطة.",
    "invalid-change": "الصلاحية أو الفترة أو السبب المرسل غير صالح.",
  },
  changeTypes: {
    PERMISSION_GRANTED: "تم منح صلاحية",
    PERMISSION_DENIED: "تم منع صلاحية",
    PERMISSION_REMOVED: "تمت إزالة استثناء صلاحية",
    APPROVAL_LIMIT_SET: "تم تعيين حد اعتماد",
    APPROVAL_LIMIT_REMOVED: "تمت إزالة حد اعتماد",
    DELEGATION_CREATED: "تم إنشاء تفويض",
    DELEGATION_REVOKED: "تم إلغاء تفويض",
    ROLE_ASSIGNED: "تم تعيين دور",
    ROLE_REVOKED: "تم إلغاء دور",
  },
};

const ms: AccessAdministrationMessages = {
  ...en,
  openAccess: "Akses",
  eyebrow: "Orang · Pentadbiran akses",
  title: (name) => `Akses ${name}`,
  description: "Semak satu tugasan peranan aktif, kebenaran berkesan, pemberian atau penafian jelas, had kelulusan, kuasa sementara dan sejarah perubahan mengikut skop.",
  backToUsers: "Kembali kepada pengguna",
  identity: "Identiti akaun",
  account: "Akaun",
  jobTitle: "Jawatan",
  assignment: "Tugasan dipilih",
  assignments: "Tugasan peranan",
  assignmentsDescription: "Hanya tugasan aktif dalam skop kebenaran semasa anda dipaparkan.",
  selected: "Dipilih",
  manageable: "Perubahan kebenaran dibenarkan",
  viewOnly: "Lihat sahaja",
  permissions: "Katalog kebenaran",
  permissionsDescription: "Berkesan bermaksud tugasan dipilih boleh menggunakan kebenaran itu selepas pemberian peranan, penafian, pemberian jelas dan delegasi aktif dinilai.",
  permission: "Kebenaran",
  source: "Sumber peranan",
  outcome: "Hasil berkesan",
  roleIncluded: "Termasuk dalam peranan",
  roleNotIncluded: "Tidak termasuk dalam peranan",
  effective: "Berkesan",
  notEffective: "Tidak berkesan",
  highRisk: "Risiko tinggi",
  standardRisk: "Standard",
  applyOverride: "Gunakan penggantian kebenaran jelas",
  applyOverrideDescription: "Perubahan dihadkan kepada skop tugasan dipilih. Penafian jelas mengatasi semua pemberian.",
  effect: "Kesan",
  grant: "Berikan",
  deny: "Nafikan",
  expiresAt: "Tarikh dan masa tamat",
  optional: "pilihan",
  reason: "Sebab",
  reasonPlaceholder: "Terangkan sebab operasi atau keselamatan bagi perubahan ini",
  apply: "Gunakan penggantian",
  applying: "Menggunakan penggantian…",
  noManagePermission: "Anda boleh menyemak tugasan ini, tetapi peranan semasa anda tidak boleh mengubah kebenarannya.",
  overrides: "Penggantian jelas aktif",
  overridesDescription: "Penggantian lebih luas yang mempengaruhi skop dipilih turut disertakan. Buang hanya tersedia apabila anda boleh mengurus skop tepat penggantian itu.",
  noOverrides: "Tiada pemberian atau penafian jelas aktif yang mempengaruhi tugasan ini.",
  changedBy: "Diubah oleh",
  period: "Tempoh berkuat kuasa",
  noExpiry: "Tiada tamat",
  remove: "Buang penggantian",
  removing: "Membuang penggantian…",
  removeReason: "Sebab pembuangan",
  approvalLimits: "Had kelulusan",
  approvalLimitsDescription: "Kuasa kelulusan kewangan berasingan daripada akses kebenaran dan kekal tertakluk kepada skop dipilih.",
  noApprovalLimits: "Tiada had kelulusan aktif yang mempengaruhi tugasan ini.",
  amount: "Amaun maksimum",
  subject: "Subjek",
  userSubject: "Pengguna ini",
  roleSubject: "Peranan ditugaskan",
  selfApproval: "Kelulusan sendiri",
  allowed: "Dibenarkan",
  notAllowed: "Tidak dibenarkan",
  delegatedAccess: "Akses didelegasikan",
  delegatedAccessDescription: "Kuasa sementara kekal sah hanya ketika pemberi asal, kebenaran langsung, tugasan dan skopnya masih aktif.",
  noDelegations: "Tiada kuasa delegasi langsung terikat pada tugasan ini.",
  authorizedBy: "Diberi kuasa oleh",
  history: "Sejarah perubahan akses",
  historyDescription: "Lima puluh perubahan terkini yang boleh dilihat dipaparkan tanpa kelayakan, token, pengecam rangkaian mentah atau cap jari identiti peribadi.",
  historyUnavailable: "Peranan semasa anda tidak mempunyai akses sejarah audit untuk skop ini.",
  noHistory: "Tiada perubahan akses yang boleh dilihat direkodkan untuk skop ini.",
  occurredAt: "Berlaku",
  platform: "Platform Axora",
  delivery: "Rangkaian penghantaran",
  scopeTypes: {
    PLATFORM: "Platform",
    COMPANY: "Syarikat",
    BRANCH: "Cawangan",
    DEPARTMENT: "Jabatan",
    SUPPLIER: "Pembekal",
    DELIVERY: "Penghantaran",
  },
  notices: {
    "override-applied": "Penggantian kebenaran digunakan dan sesi aktif pengguna terjejas telah dibatalkan.",
    "override-removed": "Penggantian kebenaran dibuang dan sesi aktif pengguna terjejas telah dibatalkan.",
    "change-unavailable": "Perubahan akses tidak dapat diselesaikan. Muat semula halaman dan sahkan tugasan serta skop masih aktif.",
    "invalid-change": "Kebenaran, tempoh atau sebab yang dihantar tidak sah.",
  },
  changeTypes: {
    PERMISSION_GRANTED: "Kebenaran diberikan",
    PERMISSION_DENIED: "Kebenaran dinafikan",
    PERMISSION_REMOVED: "Penggantian kebenaran dibuang",
    APPROVAL_LIMIT_SET: "Had kelulusan ditetapkan",
    APPROVAL_LIMIT_REMOVED: "Had kelulusan dibuang",
    DELEGATION_CREATED: "Akses delegasi dicipta",
    DELEGATION_REVOKED: "Akses delegasi dibatalkan",
    ROLE_ASSIGNED: "Peranan ditugaskan",
    ROLE_REVOKED: "Peranan dibatalkan",
  },
};

export const ACCESS_ADMINISTRATION_MESSAGES: Record<
  SupportedLocale,
  AccessAdministrationMessages
> = { en, ar, ms };

export function accessAdministrationMessages(
  locale: SupportedLocale = "en",
) {
  return ACCESS_ADMINISTRATION_MESSAGES[locale];
}

export function accessAdministrationNotice(
  locale: SupportedLocale,
  notice?: string,
) {
  if (!notice) return undefined;
  return ACCESS_ADMINISTRATION_MESSAGES[locale].notices[notice];
}

export function localizedAccessChangeType(
  locale: SupportedLocale,
  changeType: string,
) {
  return ACCESS_ADMINISTRATION_MESSAGES[locale].changeTypes[changeType]
    ?? changeType.replaceAll("_", " ").toLowerCase();
}
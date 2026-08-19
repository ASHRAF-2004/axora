import type { SupportedLocale } from "./i18n";

const copy = {
  en: {
    identityStatus: "Identity & status", profile: "Profile metadata", fullName: "Full name",
    workEmail: "Work email", emailReadOnly: "Work email is security-sensitive and remains read only here.",
    jobTitle: "Job title", language: "Interface / invitation language", saveProfile: "Save profile",
    accountState: "Account state", deactivate: "Deactivate", reactivate: "Reactivate",
    pendingTitle: "Invitation pending",
    pendingBody: "This person has not completed secure account setup. Authorization changes invalidate any setup link bound to the previous role or scope.",
    sendNewInvitation: "Send a new invitation after an access change.",
    approvalEditor: "User approval limit",
    approvalEditorBody: "Set a limit only for approval authority the selected user already possesses. Request-state and budget checks remain enforced downstream.",
    approvalPermission: "Approval permission", currency: "Currency", maximumAmount: "Maximum amount",
    selfApproval: "Allow self approval", expiry: "Optional expiry", reason: "Reason",
    setLimit: "Set / replace limit", removeLimit: "Remove limit", removalReason: "Reason for removal",
    notices: {
      "profile-updated": "Profile updated.",
      "role-scope-updated": "Role and organization scope updated. Stale sessions were invalidated; if setup is pending, the previous invitation is no longer valid.",
      "permissions-updated": "Permissions updated and stale authority invalidated.",
      "approval-limit-updated": "Approval limit updated.",
      "approval-limit-removed": "Approval limit removed.",
      "account-deactivated": "Account deactivated. Pending invitations and stale authority were invalidated.",
      "account-reactivated": "Account reactivated with its current setup state preserved.",
    } satisfies Record<string, string>,
  },
  ar: {
    identityStatus: "الهوية والحالة", profile: "بيانات الملف الشخصي", fullName: "الاسم الكامل",
    workEmail: "بريد العمل", emailReadOnly: "بريد العمل بيانات هوية حساسة ويظل للقراءة فقط هنا.",
    jobTitle: "المسمى الوظيفي", language: "لغة الواجهة / الدعوة", saveProfile: "حفظ الملف الشخصي",
    accountState: "حالة الحساب", deactivate: "إلغاء التنشيط", reactivate: "إعادة التنشيط",
    pendingTitle: "الدعوة معلّقة",
    pendingBody: "لم يُكمل هذا المستخدم إعداد الحساب الآمن. أي تغيير في الصلاحيات يُبطل رابط الإعداد المرتبط بالدور أو النطاق السابق.",
    sendNewInvitation: "أرسل دعوة جديدة بعد تغيير الوصول.",
    approvalEditor: "حد اعتماد المستخدم",
    approvalEditorBody: "عيّن حداً فقط لصلاحية اعتماد يملكها المستخدم المحدد بالفعل. تبقى فحوصات حالة الطلب والميزانية مطبقة لاحقاً.",
    approvalPermission: "صلاحية الاعتماد", currency: "العملة", maximumAmount: "الحد الأقصى",
    selfApproval: "السماح باعتماد الطلب الشخصي", expiry: "انتهاء اختياري", reason: "السبب",
    setLimit: "تعيين / استبدال الحد", removeLimit: "إزالة الحد", removalReason: "سبب الإزالة",
    notices: {
      "profile-updated": "تم تحديث الملف الشخصي.",
      "role-scope-updated": "تم تحديث الدور ونطاق المؤسسة وإبطال الجلسات القديمة. إذا كان الإعداد معلقاً فلن يعود رابط الدعوة السابق صالحاً.",
      "permissions-updated": "تم تحديث الصلاحيات وإبطال الصلاحيات القديمة في الجلسات.",
      "approval-limit-updated": "تم تحديث حد الاعتماد.",
      "approval-limit-removed": "تمت إزالة حد الاعتماد.",
      "account-deactivated": "تم إلغاء تنشيط الحساب وإبطال الدعوات المعلقة والصلاحيات القديمة.",
      "account-reactivated": "تمت إعادة تنشيط الحساب مع الحفاظ على حالة الإعداد الحالية.",
    } satisfies Record<string, string>,
  },
  ms: {
    identityStatus: "Identiti & status", profile: "Metadata profil", fullName: "Nama penuh",
    workEmail: "E-mel kerja", emailReadOnly: "E-mel kerja ialah data identiti sensitif dan kekal baca sahaja di sini.",
    jobTitle: "Jawatan", language: "Bahasa antara muka / jemputan", saveProfile: "Simpan profil",
    accountState: "Status akaun", deactivate: "Nyahaktifkan", reactivate: "Aktifkan semula",
    pendingTitle: "Jemputan belum selesai",
    pendingBody: "Pengguna ini belum melengkapkan persediaan akaun selamat. Perubahan kebenaran membatalkan pautan persediaan yang terikat pada peranan atau skop lama.",
    sendNewInvitation: "Hantar jemputan baharu selepas perubahan akses.",
    approvalEditor: "Had kelulusan pengguna",
    approvalEditorBody: "Tetapkan had hanya untuk kuasa kelulusan yang sudah dimiliki pengguna dipilih. Semakan keadaan permintaan dan bajet kekal dikuatkuasakan.",
    approvalPermission: "Kebenaran kelulusan", currency: "Mata wang", maximumAmount: "Jumlah maksimum",
    selfApproval: "Benarkan kelulusan sendiri", expiry: "Luput pilihan", reason: "Sebab",
    setLimit: "Tetapkan / ganti had", removeLimit: "Buang had", removalReason: "Sebab pembuangan",
    notices: {
      "profile-updated": "Profil dikemas kini.",
      "role-scope-updated": "Peranan dan skop organisasi dikemas kini. Sesi lama dibatalkan; jika persediaan masih belum selesai, jemputan lama tidak lagi sah.",
      "permissions-updated": "Kebenaran dikemas kini dan kuasa lama dibatalkan.",
      "approval-limit-updated": "Had kelulusan dikemas kini.",
      "approval-limit-removed": "Had kelulusan dibuang.",
      "account-deactivated": "Akaun dinyahaktifkan. Jemputan tertunda dan kuasa lama dibatalkan.",
      "account-reactivated": "Akaun diaktifkan semula dengan keadaan persediaan semasa dikekalkan.",
    } satisfies Record<string, string>,
  },
} as const;

export function existingUserManagementMessages(locale: SupportedLocale) {
  return copy[locale];
}

export function existingUserManagementNotice(locale: SupportedLocale, code?: string) {
  if (!code) return undefined;
  const notices: Readonly<Record<string, string>> = copy[locale].notices;
  return notices[code];
}

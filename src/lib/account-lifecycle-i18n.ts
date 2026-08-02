import type { SupportedLocale } from "./i18n";

export type PasswordResetErrorCode =
  | "password_mismatch"
  | "invalid_link"
  | "password_policy"
  | "save_failed";

interface AccountLifecycleMessages {
  common: {
    operations: string;
    signIn: string;
    accountSecurity: string;
    requestNewLink: string;
    tryAgain: string;
  };
  forgot: {
    recovery: string;
    storyTitle: string;
    storyBody: string;
    benefits: [string, string, string];
    eyebrow: string;
    requestedTitle: string;
    requestTitle: string;
    genericSuccess: string;
    requestedHelp: string;
    anotherAddress: string;
    emailHelp: string;
    emailLabel: string;
    languageLabel: string;
    submit: string;
    privacyNote: string;
  };
  reset: {
    privateRecovery: string;
    storyTitle: string;
    storyBody: string;
    benefits: [string, string, string];
    eyebrow: string;
    checkingTitle: string;
    checkingBody: string;
    unavailableTitle: string;
    invalidTitle: string;
    unavailableBody: string;
    invalidBody: string;
    invalidHelp: string;
    formEyebrow: string;
    formTitle: string;
    formBody: string;
    newPassword: string;
    confirmPassword: string;
    showPassword: string;
    hidePassword: string;
    passwordTooShort: string;
    passwordTooLong: string;
    requirements: string;
    submit: string;
    submitting: string;
    oneTimeNote: string;
    errors: Record<PasswordResetErrorCode, string>;
  };
  verify: {
    verification: string;
    storyTitle: string;
    storyBody: string;
    benefits: [string, string, string];
    checkingTitle: string;
    checkingBody: string;
    verifiedTitle: string;
    unavailableTitle: string;
    invalidTitle: string;
    verifiedBody: string;
    unavailableBody: string;
    invalidBody: string;
  };
  help: {
    chip: string;
    storyTitle: string;
    storyBody: string;
    eyebrow: string;
    title: string;
    intro: string;
    linkTitle: string;
    linkPoints: [string, string, string];
    passwordTitle: string;
    passwordPoints: [string, string, string];
    privacyTitle: string;
    privacyBeforeEmail: string;
    setup: string;
    linksLabel: string;
  };
  account: {
    eyebrow: string;
    title: string;
    description: string;
    overviewLabel: string;
    reauthorize: string;
    reauthorizeBody: string;
    reauthorizeHelp: string;
    reauthorizeError: string;
    reauthorizeSuccess: string;
    reauthorizeButton: string;
    reauthorizing: string;
    emailStatus: string;
    verified: string;
    verificationRequired: string;
    activeSessions: string;
    unreadNotifications: string;
    changePassword: string;
    changePasswordBody: string;
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
    showPassword: string;
    hidePassword: string;
    passwordTooShort: string;
    passwordTooLong: string;
    passwordHelp: string;
    changingPassword: string;
    emailNotifications: string;
    securityLinksBody: string;
    accountEmail: string;
    verifiedAt: (date: string) => string;
    notVerified: string;
    newestVerification: string;
    sendVerification: string;
    delivery: string;
    inApp: string;
    email: string;
    enabled: string;
    disabled: string;
    notificationHelp: string;
    sessionsTitle: string;
    sessionsBody: string;
    browserSession: string;
    current: string;
    sessionMeta: (last: string, expires: string) => string;
    endSession: string;
    otherSessions: (count: number) => string;
    noOtherSessions: string;
    endAll: string;
    feedback: Record<string, { kind: "success" | "error"; message: string }>;
  };
}

const en: AccountLifecycleMessages = {
  common: { operations: "Axora operations · Secure procurement management", signIn: "Sign in", accountSecurity: "Account & security", requestNewLink: "Request new link", tryAgain: "Try again shortly" },
  forgot: {
    recovery: "Account recovery", storyTitle: "Recover access without exposing your account.",
    storyBody: "Axora uses a short-lived, single-use link. The public response is deliberately the same whether an address is registered or not.",
    benefits: ["Reset links expire after 30 minutes", "Older reset links are cancelled", "Successful reset ends prior sessions"],
    eyebrow: "Password help", requestedTitle: "Check your email", requestTitle: "Request a reset link",
    genericSuccess: "If an eligible Axora account uses that address, private reset instructions will arrive when recovery is available.",
    requestedHelp: "Check the newest message and spam folder. For security, Axora cannot confirm whether an account exists.",
    anotherAddress: "Try another address", emailHelp: "Enter the work email used to sign in to Axora.", emailLabel: "Work email",
    languageLabel: "Email language", submit: "Send reset instructions", privacyNote: "Submitting does not reveal whether the email belongs to an Axora account.",
  },
  reset: {
    privateRecovery: "Private account recovery", storyTitle: "Choose a password known only to you.",
    storyBody: "Axora never sends or stores a reusable plaintext password. This private link works once.",
    benefits: ["Short-lived reset link", "Secure Argon2id password protection", "Prior sessions end after reset"],
    eyebrow: "Password reset", checkingTitle: "Checking your private link", checkingBody: "Please wait while Axora verifies it.",
    unavailableTitle: "Try again shortly", invalidTitle: "Request a new link", unavailableBody: "Axora could not verify this private link right now.",
    invalidBody: "This reset link is missing, invalid, expired, replaced, or already used.",
    invalidHelp: "Open the newest reset message or request a fresh link. Never forward a reset email.",
    formEyebrow: "Account recovery", formTitle: "Choose a new password", formBody: "Saving securely ends prior Axora sessions for this account.",
    newPassword: "New password", confirmPassword: "Confirm password", showPassword: "Show password", hidePassword: "Hide password",
    passwordTooShort: "Use at least 15 Unicode characters.", passwordTooLong: "Use no more than 128 Unicode characters.",
    requirements: "Use 15–128 Unicode characters. Spaces are allowed; there is no uppercase, number, or symbol rule. Paste and password managers are supported. Do not reuse a password from another service.",
    submit: "Save new password", submitting: "Saving password…", oneTimeNote: "The private link stops working immediately after a successful reset.",
    errors: {
      password_mismatch: "The passwords do not match. Enter the same password in both fields.",
      invalid_link: "This reset link is invalid, expired, replaced, or has already been used.",
      password_policy: "Use 15–128 Unicode characters. Your password is never truncated.",
      save_failed: "Axora could not change the password. The link was not used; please try again.",
    },
  },
  verify: {
    verification: "Email verification", storyTitle: "Confirm your Axora email safely.", storyBody: "The private link is bound to your current account address and works only once.",
    benefits: ["Single-use verification", "Current-address binding", "No password is requested"],
    checkingTitle: "Confirming your address", checkingBody: "Please wait while Axora checks this private link.",
    verifiedTitle: "Email verified", unavailableTitle: "Try again shortly", invalidTitle: "Request a new link",
    verifiedBody: "Your Axora account email is now verified. This private link cannot be used again.",
    unavailableBody: "Axora could not verify this link right now. Reopen the newest message shortly.",
    invalidBody: "This verification link is missing, invalid, expired, replaced, or already used.",
  },
  help: {
    chip: "Account help", storyTitle: "Get your account ready safely.",
    storyBody: "Axora invitations use a private, single-use link. These checks fix the most common setup problems without sharing your password.",
    eyebrow: "Troubleshooting", title: "Account setup help", intro: "Use the newest invitation email sent to your assigned work address.",
    linkTitle: "If the link is invalid or expired",
    linkPoints: ["Open the newest invitation. Resending automatically cancels every older link.", "A setup link works once and stops working after its expiry time.", "Ask your company administrator to choose Resend invite on the Users page."],
    passwordTitle: "If the password is not accepted",
    passwordPoints: ["Enter the same password in both fields.", "Use 15–128 Unicode characters. Spaces and paste are allowed; uppercase letters, numbers, and symbols are not required.", "After setup succeeds, sign in with the email shown in your invitation and your new password."],
    privacyTitle: "Keep the invitation private", privacyBeforeEmail: "If you did not expect the invitation, do not use or forward it. Contact your company administrator or email",
    setup: "Account setup", linksLabel: "Account setup help links",
  },
  account: {
    eyebrow: "Personal settings", title: "Account & security", description: "Manage your password, email verification, notifications, and active Axora sessions.",
    reauthorize: "Re-authorize this action", reauthorizeBody: "For security, this operation needs one additional confirmation with your current password.",
    reauthorizeHelp: "Use the same password you use for this account. Passwords are never shown or stored after this check.",
    reauthorizeError: "The password check failed. Try again.",
    reauthorizeSuccess: "Your identity is confirmed. This action is unlocked for a short time.",
    reauthorizeButton: "Confirm and continue", reauthorizing: "Verifying identity…",
    overviewLabel: "Account security overview", emailStatus: "Email status", verified: "Verified", verificationRequired: "Verification required",
    activeSessions: "Active sessions", unreadNotifications: "Unread notifications", changePassword: "Change password",
    changePasswordBody: "Your current password is required. Saving ends every prior session and safely renews this browser.",
    currentPassword: "Current password", newPassword: "New password", confirmPassword: "Confirm new password", showPassword: "Show password", hidePassword: "Hide password",
    passwordTooShort: "Use at least 15 Unicode characters.", passwordTooLong: "Use no more than 128 Unicode characters.",
    passwordHelp: "Use 15–128 Unicode characters and a password different from the current one. Spaces, paste, and password managers are supported; uppercase letters, numbers, and symbols are not required.", changingPassword: "Changing password…",
    emailNotifications: "Email & notifications", securityLinksBody: "Security links go only to the sign-in address assigned to this account.",
    accountEmail: "Account email", verifiedAt: (date) => `Verified ${date}`, notVerified: "This address has not been verified yet.",
    newestVerification: "The newest link replaces any older verification link.", sendVerification: "Send verification email",
    delivery: "Notification delivery", inApp: "In-app", email: "Email", enabled: "enabled", disabled: "disabled",
    notificationHelp: "Detailed event choices are available on the Notifications page.", sessionsTitle: "Active sessions",
    sessionsBody: "Only session activity is shown. Axora never displays cookie values, token hashes, or network fingerprints.",
    browserSession: "Axora browser session", current: "Current", sessionMeta: (last, expires) => `Last active ${last} · Expires ${expires}`,
    endSession: "End session", otherSessions: (count) => `${count} other active session${count === 1 ? "" : "s"}.`, noOtherSessions: "No other active sessions.", endAll: "End all other sessions",
    feedback: {
      "password-changed": { kind: "success", message: "Your password was changed and prior sessions were ended." },
      "change-failed": { kind: "error", message: "Axora could not change the password. Check the current password and try again." },
      "password-mismatch": { kind: "error", message: "The two new-password entries do not match." },
      "password-reused": { kind: "error", message: "Choose a new password that is different from the current password." },
      "password-policy": { kind: "error", message: "Use a memorable passphrase of 15–128 Unicode characters. Your password is never truncated." },
      "session-revoked": { kind: "success", message: "The selected session was ended." },
      "sessions-revoked": { kind: "success", message: "All other active sessions were ended." },
      "session-failed": { kind: "error", message: "Axora could not update the selected sessions." },
      "verification-sent": { kind: "success", message: "If verification is still required, a fresh private link has been queued." },
      "verification-failed": { kind: "error", message: "Axora could not queue a verification message right now." },
      "reauth-success": { kind: "success", message: "Security re-authorization completed." },
    },
  },
};

const ms: AccountLifecycleMessages = {
  common: { operations: "Operasi Axora · Pengurusan perolehan selamat", signIn: "Log masuk", accountSecurity: "Akaun & keselamatan", requestNewLink: "Minta pautan baharu", tryAgain: "Cuba lagi sebentar lagi" },
  forgot: {
    recovery: "Pemulihan akaun", storyTitle: "Pulihkan akses tanpa mendedahkan akaun anda.",
    storyBody: "Axora menggunakan pautan sekali guna yang berjangka pendek. Jawapan awam adalah sama sama ada alamat didaftarkan atau tidak.",
    benefits: ["Pautan tetapan semula tamat selepas 30 minit", "Pautan lama dibatalkan", "Tetapan semula yang berjaya menamatkan sesi terdahulu"],
    eyebrow: "Bantuan kata laluan", requestedTitle: "Semak e-mel anda", requestTitle: "Minta pautan tetapan semula",
    genericSuccess: "Jika akaun Axora yang layak menggunakan alamat itu, arahan tetapan semula peribadi akan dihantar apabila pemulihan tersedia.",
    requestedHelp: "Semak mesej terbaharu dan folder spam. Demi keselamatan, Axora tidak dapat mengesahkan sama ada akaun wujud.",
    anotherAddress: "Cuba alamat lain", emailHelp: "Masukkan e-mel kerja yang digunakan untuk log masuk ke Axora.", emailLabel: "E-mel kerja",
    languageLabel: "Bahasa e-mel", submit: "Hantar arahan tetapan semula", privacyNote: "Penghantaran tidak mendedahkan sama ada e-mel itu milik akaun Axora.",
  },
  reset: {
    privateRecovery: "Pemulihan akaun peribadi", storyTitle: "Pilih kata laluan yang hanya anda tahu.",
    storyBody: "Axora tidak menghantar atau menyimpan kata laluan teks biasa yang boleh digunakan semula. Pautan peribadi ini berfungsi sekali.",
    benefits: ["Pautan tetapan semula berjangka pendek", "Perlindungan kata laluan Argon2id", "Sesi terdahulu tamat selepas tetapan semula"],
    eyebrow: "Tetapan semula kata laluan", checkingTitle: "Menyemak pautan peribadi anda", checkingBody: "Sila tunggu sementara Axora mengesahkannya.",
    unavailableTitle: "Cuba lagi sebentar lagi", invalidTitle: "Minta pautan baharu", unavailableBody: "Axora tidak dapat mengesahkan pautan peribadi ini sekarang.",
    invalidBody: "Pautan tetapan semula ini tiada, tidak sah, tamat tempoh, telah diganti atau telah digunakan.",
    invalidHelp: "Buka mesej tetapan semula terbaharu atau minta pautan baharu. Jangan majukan e-mel tetapan semula.",
    formEyebrow: "Pemulihan akaun", formTitle: "Pilih kata laluan baharu", formBody: "Penyimpanan akan menamatkan sesi Axora terdahulu untuk akaun ini dengan selamat.",
    newPassword: "Kata laluan baharu", confirmPassword: "Sahkan kata laluan", showPassword: "Tunjukkan kata laluan", hidePassword: "Sembunyikan kata laluan",
    passwordTooShort: "Gunakan sekurang-kurangnya 15 aksara Unicode.", passwordTooLong: "Gunakan tidak lebih daripada 128 aksara Unicode.",
    requirements: "Gunakan 15–128 aksara Unicode. Ruang dibenarkan; tiada syarat huruf besar, nombor atau simbol. Tampal dan pengurus kata laluan disokong. Jangan guna semula kata laluan perkhidmatan lain.",
    submit: "Simpan kata laluan baharu", submitting: "Menyimpan kata laluan…", oneTimeNote: "Pautan peribadi berhenti berfungsi sebaik sahaja tetapan semula berjaya.",
    errors: {
      password_mismatch: "Kata laluan tidak sepadan. Masukkan kata laluan yang sama dalam kedua-dua medan.",
      invalid_link: "Pautan ini tidak sah, tamat tempoh, diganti atau telah digunakan.",
      password_policy: "Gunakan 15–128 aksara Unicode. Kata laluan anda tidak dipendekkan.",
      save_failed: "Axora tidak dapat menukar kata laluan. Pautan belum digunakan; sila cuba lagi.",
    },
  },
  verify: {
    verification: "Pengesahan e-mel", storyTitle: "Sahkan e-mel Axora anda dengan selamat.", storyBody: "Pautan peribadi terikat pada alamat akaun semasa anda dan berfungsi sekali sahaja.",
    benefits: ["Pengesahan sekali guna", "Terikat pada alamat semasa", "Kata laluan tidak diminta"],
    checkingTitle: "Mengesahkan alamat anda", checkingBody: "Sila tunggu sementara Axora menyemak pautan peribadi ini.",
    verifiedTitle: "E-mel disahkan", unavailableTitle: "Cuba lagi sebentar lagi", invalidTitle: "Minta pautan baharu",
    verifiedBody: "E-mel akaun Axora anda kini disahkan. Pautan peribadi ini tidak boleh digunakan lagi.",
    unavailableBody: "Axora tidak dapat mengesahkan pautan ini sekarang. Buka semula mesej terbaharu sebentar lagi.",
    invalidBody: "Pautan pengesahan ini tiada, tidak sah, tamat tempoh, telah diganti atau telah digunakan.",
  },
  help: {
    chip: "Bantuan akaun", storyTitle: "Sediakan akaun anda dengan selamat.",
    storyBody: "Jemputan Axora menggunakan pautan peribadi sekali guna. Semakan ini menyelesaikan masalah biasa tanpa berkongsi kata laluan anda.",
    eyebrow: "Penyelesaian masalah", title: "Bantuan persediaan akaun", intro: "Gunakan e-mel jemputan terbaharu yang dihantar ke alamat kerja anda.",
    linkTitle: "Jika pautan tidak sah atau tamat tempoh",
    linkPoints: ["Buka jemputan terbaharu. Penghantaran semula membatalkan semua pautan lama.", "Pautan persediaan berfungsi sekali dan berhenti selepas masa tamatnya.", "Minta pentadbir syarikat memilih Hantar semula jemputan pada halaman Pengguna."],
    passwordTitle: "Jika kata laluan tidak diterima",
    passwordPoints: ["Masukkan kata laluan yang sama dalam kedua-dua medan.", "Gunakan 15–128 aksara Unicode. Ruang dan tampal dibenarkan; huruf besar, nombor dan simbol tidak diwajibkan.", "Selepas persediaan berjaya, log masuk menggunakan e-mel dalam jemputan dan kata laluan baharu anda."],
    privacyTitle: "Pastikan jemputan kekal peribadi", privacyBeforeEmail: "Jika anda tidak menjangka jemputan ini, jangan guna atau majukannya. Hubungi pentadbir syarikat anda atau e-mel",
    setup: "Persediaan akaun", linksLabel: "Pautan bantuan persediaan akaun",
  },
  account: {
    eyebrow: "Tetapan peribadi", title: "Akaun & keselamatan", description: "Urus kata laluan, pengesahan e-mel, pemberitahuan dan sesi Axora aktif anda.",
    reauthorize: "Sahkan semula tindakan ini", reauthorizeBody: "Untuk keselamatan, operasi ini memerlukan pengesahan dengan kata laluan semasa anda.",
    reauthorizeHelp: "Gunakan kata laluan yang sama seperti log masuk akaun ini. Kata laluan tidak dipaparkan atau disimpan selepas semakan ini.",
    reauthorizeError: "Semakan kata laluan gagal. Cuba sekali lagi.",
    reauthorizeSuccess: "Pengesahan keselamatan berjaya. Akses tindakan ini dibuka buat sementara waktu.",
    reauthorizeButton: "Sahkan dan teruskan", reauthorizing: "Mengesahkan identiti…",
    overviewLabel: "Ringkasan keselamatan akaun", emailStatus: "Status e-mel", verified: "Disahkan", verificationRequired: "Pengesahan diperlukan",
    activeSessions: "Sesi aktif", unreadNotifications: "Pemberitahuan belum dibaca", changePassword: "Tukar kata laluan",
    changePasswordBody: "Kata laluan semasa diperlukan. Penyimpanan menamatkan semua sesi terdahulu dan memperbaharui pelayar ini dengan selamat.",
    currentPassword: "Kata laluan semasa", newPassword: "Kata laluan baharu", confirmPassword: "Sahkan kata laluan baharu", showPassword: "Tunjukkan kata laluan", hidePassword: "Sembunyikan kata laluan",
    passwordTooShort: "Gunakan sekurang-kurangnya 15 aksara Unicode.", passwordTooLong: "Gunakan tidak lebih daripada 128 aksara Unicode.",
    passwordHelp: "Gunakan 15–128 aksara Unicode dan kata laluan yang berbeza daripada kata laluan semasa. Ruang, tampal dan pengurus kata laluan disokong; huruf besar, nombor dan simbol tidak diwajibkan.", changingPassword: "Menukar kata laluan…",
    emailNotifications: "E-mel & pemberitahuan", securityLinksBody: "Pautan keselamatan hanya dihantar ke alamat log masuk akaun ini.",
    accountEmail: "E-mel akaun", verifiedAt: (date) => `Disahkan ${date}`, notVerified: "Alamat ini belum disahkan.",
    newestVerification: "Pautan terbaharu menggantikan semua pautan pengesahan lama.", sendVerification: "Hantar e-mel pengesahan",
    delivery: "Penghantaran pemberitahuan", inApp: "Dalam aplikasi", email: "E-mel", enabled: "diaktifkan", disabled: "dinyahaktifkan",
    notificationHelp: "Pilihan acara terperinci tersedia pada halaman Pemberitahuan.", sessionsTitle: "Sesi aktif",
    sessionsBody: "Hanya aktiviti sesi ditunjukkan. Axora tidak memaparkan nilai kuki, hash token atau cap jari rangkaian.",
    browserSession: "Sesi pelayar Axora", current: "Semasa", sessionMeta: (last, expires) => `Aktif terakhir ${last} · Tamat ${expires}`,
    endSession: "Tamatkan sesi", otherSessions: (count) => `${count} sesi aktif lain.`, noOtherSessions: "Tiada sesi aktif lain.", endAll: "Tamatkan semua sesi lain",
    feedback: {
      "password-changed": { kind: "success", message: "Kata laluan anda telah ditukar dan sesi terdahulu ditamatkan." },
      "change-failed": { kind: "error", message: "Axora tidak dapat menukar kata laluan. Semak kata laluan semasa dan cuba lagi." },
      "password-mismatch": { kind: "error", message: "Dua entri kata laluan baharu tidak sepadan." },
      "password-reused": { kind: "error", message: "Pilih kata laluan baharu yang berbeza daripada kata laluan semasa." },
      "password-policy": { kind: "error", message: "Gunakan frasa laluan yang mudah diingati sepanjang 15–128 aksara Unicode. Kata laluan anda tidak dipendekkan." },
      "session-revoked": { kind: "success", message: "Sesi yang dipilih telah ditamatkan." },
      "sessions-revoked": { kind: "success", message: "Semua sesi aktif lain telah ditamatkan." },
      "session-failed": { kind: "error", message: "Axora tidak dapat mengemas kini sesi yang dipilih." },
      "verification-sent": { kind: "success", message: "Jika pengesahan masih diperlukan, pautan peribadi baharu telah dimasukkan dalam baris gilir." },
      "verification-failed": { kind: "error", message: "Axora tidak dapat memasukkan mesej pengesahan dalam baris gilir sekarang." },
      "reauth-success": { kind: "success", message: "Pengesahan semula keselamatan selesai." },
    },
  },
};

const ar: AccountLifecycleMessages = {
  common: { operations: "عمليات Axora · إدارة مشتريات آمنة", signIn: "تسجيل الدخول", accountSecurity: "الحساب والأمان", requestNewLink: "طلب رابط جديد", tryAgain: "حاول مجددًا بعد قليل" },
  forgot: {
    recovery: "استعادة الحساب", storyTitle: "استعد الوصول دون كشف حسابك.",
    storyBody: "تستخدم Axora رابطًا قصير الصلاحية ولمرة واحدة. تكون الاستجابة العامة متطابقة سواء كان العنوان مسجلاً أم لا.",
    benefits: ["تنتهي صلاحية روابط الاستعادة بعد 30 دقيقة", "تُلغى الروابط الأقدم", "تنهي الاستعادة الناجحة الجلسات السابقة"],
    eyebrow: "مساعدة كلمة المرور", requestedTitle: "تحقق من بريدك", requestTitle: "اطلب رابط استعادة",
    genericSuccess: "إذا كان حساب Axora مؤهلًا ويستخدم هذا العنوان، فستصل تعليمات الاستعادة الخاصة عندما تكون الاستعادة متاحة.",
    requestedHelp: "تحقق من أحدث رسالة ومجلد البريد غير المرغوب. لأسباب أمنية، لا تؤكد Axora وجود الحساب.",
    anotherAddress: "جرّب عنوانًا آخر", emailHelp: "أدخل بريد العمل المستخدم لتسجيل الدخول إلى Axora.", emailLabel: "بريد العمل",
    languageLabel: "لغة البريد", submit: "إرسال تعليمات الاستعادة", privacyNote: "لا يكشف الإرسال ما إذا كان البريد مرتبطًا بحساب Axora.",
  },
  reset: {
    privateRecovery: "استعادة خاصة للحساب", storyTitle: "اختر كلمة مرور لا يعرفها سواك.",
    storyBody: "لا ترسل Axora أو تخزن كلمة مرور نصية قابلة لإعادة الاستخدام. يعمل هذا الرابط الخاص مرة واحدة.",
    benefits: ["رابط استعادة قصير الصلاحية", "حماية آمنة لكلمة المرور عبر Argon2id", "تنتهي الجلسات السابقة بعد الاستعادة"],
    eyebrow: "استعادة كلمة المرور", checkingTitle: "جارٍ فحص رابطك الخاص", checkingBody: "يرجى الانتظار بينما تتحقق Axora منه.",
    unavailableTitle: "حاول مجددًا بعد قليل", invalidTitle: "اطلب رابطًا جديدًا", unavailableBody: "تعذر على Axora التحقق من هذا الرابط الخاص الآن.",
    invalidBody: "رابط الاستعادة مفقود أو غير صالح أو منتهي الصلاحية أو مستبدل أو مستخدم.",
    invalidHelp: "افتح أحدث رسالة استعادة أو اطلب رابطًا جديدًا. لا تُعِد توجيه رسالة الاستعادة.",
    formEyebrow: "استعادة الحساب", formTitle: "اختر كلمة مرور جديدة", formBody: "يؤدي الحفظ بأمان إلى إنهاء جلسات Axora السابقة لهذا الحساب.",
    newPassword: "كلمة المرور الجديدة", confirmPassword: "تأكيد كلمة المرور", showPassword: "إظهار كلمة المرور", hidePassword: "إخفاء كلمة المرور",
    passwordTooShort: "استخدم 15 محرف Unicode على الأقل.", passwordTooLong: "استخدم 128 محرف Unicode كحد أقصى.",
    requirements: "استخدم من 15 إلى 128 محرف Unicode. المسافات مسموحة، ولا يُشترط حرف كبير أو رقم أو رمز. اللصق ومديرو كلمات المرور مدعومون. لا تعِد استخدام كلمة مرور من خدمة أخرى.",
    submit: "حفظ كلمة المرور الجديدة", submitting: "جارٍ حفظ كلمة المرور…", oneTimeNote: "يتوقف الرابط الخاص عن العمل فور نجاح الاستعادة.",
    errors: {
      password_mismatch: "كلمتا المرور غير متطابقتين. أدخل كلمة المرور نفسها في الحقلين.",
      invalid_link: "الرابط غير صالح أو منتهي أو مستبدل أو مستخدم مسبقًا.",
      password_policy: "استخدم من 15 إلى 128 محرف Unicode. لا يتم اقتطاع كلمة المرور.",
      save_failed: "تعذر على Axora تغيير كلمة المرور. لم يُستخدم الرابط؛ حاول مجددًا.",
    },
  },
  verify: {
    verification: "التحقق من البريد", storyTitle: "أكد بريد Axora بأمان.", storyBody: "يرتبط الرابط الخاص بعنوان حسابك الحالي ويعمل مرة واحدة فقط.",
    benefits: ["تحقق لمرة واحدة", "مرتبط بالعنوان الحالي", "لا تُطلب كلمة المرور"],
    checkingTitle: "جارٍ تأكيد عنوانك", checkingBody: "يرجى الانتظار بينما تفحص Axora هذا الرابط الخاص.",
    verifiedTitle: "تم تأكيد البريد", unavailableTitle: "حاول مجددًا بعد قليل", invalidTitle: "اطلب رابطًا جديدًا",
    verifiedBody: "تم الآن تأكيد بريد حساب Axora. لا يمكن استخدام هذا الرابط الخاص مرة أخرى.",
    unavailableBody: "تعذر على Axora التحقق من الرابط الآن. افتح أحدث رسالة مرة أخرى بعد قليل.",
    invalidBody: "رابط التحقق مفقود أو غير صالح أو منتهي الصلاحية أو مستبدل أو مستخدم.",
  },
  help: {
    chip: "مساعدة الحساب", storyTitle: "جهّز حسابك بأمان.",
    storyBody: "تستخدم دعوات Axora رابطًا خاصًا ولمرة واحدة. تحل هذه الخطوات أكثر مشكلات الإعداد شيوعًا دون مشاركة كلمة مرورك.",
    eyebrow: "استكشاف الأخطاء", title: "مساعدة إعداد الحساب", intro: "استخدم أحدث رسالة دعوة أُرسلت إلى عنوان عملك المحدد.",
    linkTitle: "إذا كان الرابط غير صالح أو منتهيًا",
    linkPoints: ["افتح أحدث دعوة. تؤدي إعادة الإرسال إلى إلغاء كل رابط أقدم.", "يعمل رابط الإعداد مرة واحدة ويتوقف بعد انتهاء صلاحيته.", "اطلب من مسؤول الشركة اختيار إعادة إرسال الدعوة في صفحة المستخدمين."],
    passwordTitle: "إذا لم تُقبل كلمة المرور",
    passwordPoints: ["أدخل كلمة المرور نفسها في الحقلين.", "استخدم من 15 إلى 128 محرف Unicode. المسافات واللصق مسموحان، ولا تُشترط الأحرف الكبيرة أو الأرقام أو الرموز.", "بعد نجاح الإعداد، سجّل الدخول بالبريد الظاهر في الدعوة وكلمة مرورك الجديدة."],
    privacyTitle: "حافظ على خصوصية الدعوة", privacyBeforeEmail: "إذا لم تكن تتوقع الدعوة، فلا تستخدمها أو تعِد توجيهها. تواصل مع مسؤول شركتك أو راسل",
    setup: "إعداد الحساب", linksLabel: "روابط مساعدة إعداد الحساب",
  },
  account: {
    eyebrow: "الإعدادات الشخصية", title: "الحساب والأمان", description: "أدر كلمة المرور والتحقق من البريد والإشعارات وجلسات Axora النشطة.",
    reauthorize: "إعادة المصادقة على هذا الإجراء", reauthorizeBody: "لأسباب أمنية، يحتاج هذا الإجراء إلى تأكيد إضافي باستخدام كلمة المرور الحالية.",
    reauthorizeHelp: "استخدم نفس كلمة المرور الخاصة بحسابك. لا يتم عرض كلمات المرور أو تخزينها بعد هذا التحقق.",
    reauthorizeError: "فشل التحقق من كلمة المرور. حاول مرة أخرى.",
    reauthorizeSuccess: "تم التحقق من هويتك. تم فتح هذا الإجراء لفترة قصيرة.",
    reauthorizeButton: "تأكيد ومتابعة", reauthorizing: "جارٍ التحقق من الهوية…",
    overviewLabel: "نظرة عامة على أمان الحساب", emailStatus: "حالة البريد", verified: "مؤكد", verificationRequired: "التحقق مطلوب",
    activeSessions: "الجلسات النشطة", unreadNotifications: "إشعارات غير مقروءة", changePassword: "تغيير كلمة المرور",
    changePasswordBody: "كلمة المرور الحالية مطلوبة. يؤدي الحفظ إلى إنهاء كل الجلسات السابقة وتجديد هذا المتصفح بأمان.",
    currentPassword: "كلمة المرور الحالية", newPassword: "كلمة المرور الجديدة", confirmPassword: "تأكيد كلمة المرور الجديدة", showPassword: "إظهار كلمة المرور", hidePassword: "إخفاء كلمة المرور",
    passwordTooShort: "استخدم 15 محرف Unicode على الأقل.", passwordTooLong: "استخدم 128 محرف Unicode كحد أقصى.",
    passwordHelp: "استخدم من 15 إلى 128 محرف Unicode وكلمة مرور تختلف عن الحالية. المسافات واللصق ومديرو كلمات المرور مدعومون، ولا تُشترط الأحرف الكبيرة أو الأرقام أو الرموز.", changingPassword: "جارٍ تغيير كلمة المرور…",
    emailNotifications: "البريد والإشعارات", securityLinksBody: "تُرسل روابط الأمان فقط إلى عنوان تسجيل الدخول المخصص لهذا الحساب.",
    accountEmail: "بريد الحساب", verifiedAt: (date) => `تم التأكيد ${date}`, notVerified: "لم يتم تأكيد هذا العنوان بعد.",
    newestVerification: "يستبدل أحدث رابط كل روابط التحقق الأقدم.", sendVerification: "إرسال رسالة تحقق",
    delivery: "توصيل الإشعارات", inApp: "داخل التطبيق", email: "البريد", enabled: "مفعّل", disabled: "معطّل",
    notificationHelp: "تتوفر خيارات الأحداث التفصيلية في صفحة الإشعارات.", sessionsTitle: "الجلسات النشطة",
    sessionsBody: "يظهر نشاط الجلسة فقط. لا تعرض Axora قيم ملفات الارتباط أو تجزئات الرموز أو بصمات الشبكة.",
    browserSession: "جلسة متصفح Axora", current: "الحالية", sessionMeta: (last, expires) => `آخر نشاط ${last} · تنتهي ${expires}`,
    endSession: "إنهاء الجلسة", otherSessions: (count) => `${count} جلسة نشطة أخرى.`, noOtherSessions: "لا توجد جلسات نشطة أخرى.", endAll: "إنهاء كل الجلسات الأخرى",
    feedback: {
      "password-changed": { kind: "success", message: "تم تغيير كلمة المرور وإنهاء الجلسات السابقة." },
      "change-failed": { kind: "error", message: "تعذر على Axora تغيير كلمة المرور. تحقق من كلمة المرور الحالية وحاول مجددًا." },
      "password-mismatch": { kind: "error", message: "إدخالا كلمة المرور الجديدة غير متطابقين." },
      "password-reused": { kind: "error", message: "اختر كلمة مرور جديدة تختلف عن الحالية." },
      "password-policy": { kind: "error", message: "استخدم عبارة مرور سهلة التذكر من 15 إلى 128 محرف Unicode. لا يتم اقتطاع كلمة المرور." },
      "session-revoked": { kind: "success", message: "تم إنهاء الجلسة المحددة." },
      "sessions-revoked": { kind: "success", message: "تم إنهاء كل الجلسات النشطة الأخرى." },
      "session-failed": { kind: "error", message: "تعذر على Axora تحديث الجلسات المحددة." },
      "verification-sent": { kind: "success", message: "إذا كان التحقق لا يزال مطلوبًا، فقد وُضع رابط خاص جديد في قائمة الإرسال." },
      "verification-failed": { kind: "error", message: "تعذر على Axora إدراج رسالة تحقق للإرسال الآن." },
      "reauth-success": { kind: "success", message: "اكتملت إعادة التوثيق الأمنية." },
    },
  },
};

export const ACCOUNT_LIFECYCLE_MESSAGES: Record<SupportedLocale, AccountLifecycleMessages> = { en, ar, ms };

export function accountLifecycleMessages(locale: SupportedLocale) {
  return ACCOUNT_LIFECYCLE_MESSAGES[locale];
}

export function formatAccountDateTime(value: string, locale: SupportedLocale, timeZone: string) {
  const languageTag = locale === "ar" ? "ar-MY" : locale === "ms" ? "ms-MY" : "en-MY";
  try {
    return new Intl.DateTimeFormat(languageTag, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat(languageTag, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value));
  }
}

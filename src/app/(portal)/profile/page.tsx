import { PageHeader } from "@/components/PageHeader";
import { ProfileImageManager } from "@/components/ProfileImageManager";
import { InternationalPhoneInput } from "@/components/InternationalPhoneInput";
import { requireAccountLifecycleSession } from "@/lib/auth";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "@/lib/i18n";
import { getMyProfile, myProfileMeetsRequiredOnboarding } from "@/lib/profile";
import { getProfileImagePolicy } from "@/lib/profile-images";
import { safeInternalReturnPath } from "@/lib/session-return";
import { BellRing, CheckCircle2, Languages, ShieldCheck, UserRound } from "lucide-react";
import Image from "next/image";
import { portalMessages } from "@/lib/portal-i18n";
import {
  removeProfileImageAction,
  saveProfileAction,
  uploadProfileImageAction,
} from "./actions";

const timezones = [
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Europe/London",
  "UTC",
];

const profileCopy = {
  en: {
    firstStep: "First step · Your profile", personalSettings: "Personal settings",
    onboardingTitle: "Tell your team who you are", title: "My profile",
    onboardingDescription: "Confirm your profile before Axora introduces the tools for your role. We keep the information already received with your invitation.",
    description: "Keep your contact details, language, time zone, avatar, and notification choices accurate.",
    saved: "Your profile changes were saved.", invalidImage: "Use a valid PNG, JPEG, or WebP image smaller than 1 MB.",
    invalid: "Review the highlighted profile fields and try again.", profileImage: "Profile image", imageAlt: (name: string) => `${name} profile image`,
    choosePhoto: "Choose photo", upload: "Upload", removePhoto: "Remove photo", imageHelp: "PNG, JPEG, or WebP · maximum 1 MB",
    formLabel: "Personal profile", personal: "Personal information", personalHelp: "Used to identify you in requests, approvals, deliveries, and audit history.",
    displayName: "Display name", jobTitle: "Job title", jobExample: "For example, Branch manager", phone: "Phone", accountEmail: "Account email",
    emailHelp: "Contact an authorized administrator to change the sign-in email.", languageTime: "Language and time", languageHelp: "Dates, email, and guidance use these personal preferences.",
    preferredLanguage: "Preferred language", timeZone: "Time zone", assignedTeam: "Assigned team", chooseTeam: "Choose your assigned team", teamHelp: "Confirm the team and scope already assigned by your administrator. This does not grant new access.", notifications: "Notifications",
    notificationsHelp: "In-app workflow evidence is always available. Optional email and reminder choices are managed in Notifications.",
    inApp: "In-app notifications", inAppHelp: "Always on so assignments, decisions, delivery events, and exceptions remain available.",
    email: "Email notifications", emailNotificationsHelp: "Send important transactional updates to your account email.",
    policy: "I confirm these details and accept the required Axora policies.", policyHelp: "Do not share your account, password, session, or invitation links.",
    next: "Next: your Axora workspace", audit: "Changes are recorded in the audit trail.", saveContinue: "Save and continue", save: "Save profile",
  },
  ar: {
    firstStep: "الخطوة الأولى · ملفك الشخصي", personalSettings: "الإعدادات الشخصية",
    onboardingTitle: "عرّف فريقك بنفسك", title: "ملفي الشخصي",
    onboardingDescription: "أكد بيانات ملفك قبل أن تعرّفك Axora بأدوات دورك. نحتفظ بالمعلومات التي وصلت مع دعوتك.",
    description: "حافظ على صحة بيانات الاتصال واللغة والمنطقة الزمنية والصورة وتفضيلات الإشعارات.",
    saved: "تم حفظ تغييرات ملفك الشخصي.", invalidImage: "استخدم صورة PNG أو JPEG أو WebP صالحة وأصغر من 1 ميجابايت.",
    invalid: "راجع حقول الملف المحددة وحاول مرة أخرى.", profileImage: "صورة الملف الشخصي", imageAlt: (name: string) => `صورة الملف الشخصي لـ ${name}`,
    choosePhoto: "اختيار صورة", upload: "رفع", removePhoto: "إزالة الصورة", imageHelp: "PNG أو JPEG أو WebP · الحد الأقصى 1 ميجابايت",
    formLabel: "الملف الشخصي", personal: "المعلومات الشخصية", personalHelp: "تُستخدم للتعريف بك في الطلبات والاعتمادات والتسليمات وسجل التدقيق.",
    displayName: "اسم العرض", jobTitle: "المسمى الوظيفي", jobExample: "مثال: مدير فرع", phone: "الهاتف", accountEmail: "بريد الحساب",
    emailHelp: "تواصل مع مدير مخوّل لتغيير بريد تسجيل الدخول.", languageTime: "اللغة والوقت", languageHelp: "تستخدم التواريخ والرسائل والإرشادات هذه التفضيلات.",
    preferredLanguage: "اللغة المفضلة", timeZone: "المنطقة الزمنية", assignedTeam: "الفريق المعيّن", chooseTeam: "اختر فريقك المعيّن", teamHelp: "أكد الفريق والنطاق اللذين عيّنهما لك المسؤول. لا يمنح هذا الاختيار صلاحيات جديدة.", notifications: "الإشعارات",
    notificationsHelp: "تبقى أدلة سير العمل داخل التطبيق متاحة دائماً. تُدار خيارات البريد والتذكير الاختيارية في الإشعارات.",
    inApp: "إشعارات داخل التطبيق", inAppHelp: "مفعّلة دائماً حتى تبقى المهام والقرارات وأحداث التسليم والاستثناءات متاحة.",
    email: "إشعارات البريد الإلكتروني", emailNotificationsHelp: "إرسال التحديثات المهمة إلى بريد حسابك.",
    policy: "أؤكد صحة هذه البيانات وأوافق على سياسات Axora المطلوبة.", policyHelp: "لا تشارك حسابك أو كلمة مرورك أو جلستك أو روابط الدعوة.",
    next: "التالي: مساحة عمل Axora الخاصة بك", audit: "تُسجل التغييرات في سجل التدقيق.", saveContinue: "حفظ ومتابعة", save: "حفظ الملف",
  },
  ms: {
    firstStep: "Langkah pertama · Profil anda", personalSettings: "Tetapan peribadi",
    onboardingTitle: "Perkenalkan diri anda kepada pasukan", title: "Profil saya",
    onboardingDescription: "Sahkan profil sebelum Axora memperkenalkan alat untuk peranan anda. Kami mengekalkan maklumat yang telah diterima bersama jemputan.",
    description: "Pastikan butiran hubungan, bahasa, zon waktu, avatar dan pilihan pemberitahuan anda tepat.",
    saved: "Perubahan profil anda telah disimpan.", invalidImage: "Gunakan imej PNG, JPEG atau WebP yang sah dan lebih kecil daripada 1 MB.",
    invalid: "Semak medan profil yang ditandakan dan cuba lagi.", profileImage: "Imej profil", imageAlt: (name: string) => `Imej profil ${name}`,
    choosePhoto: "Pilih foto", upload: "Muat naik", removePhoto: "Buang foto", imageHelp: "PNG, JPEG atau WebP · maksimum 1 MB",
    formLabel: "Profil peribadi", personal: "Maklumat peribadi", personalHelp: "Digunakan untuk mengenal pasti anda dalam permintaan, kelulusan, penghantaran dan sejarah audit.",
    displayName: "Nama paparan", jobTitle: "Jawatan", jobExample: "Contohnya, Pengurus cawangan", phone: "Telefon", accountEmail: "E-mel akaun",
    emailHelp: "Hubungi pentadbir yang dibenarkan untuk menukar e-mel log masuk.", languageTime: "Bahasa dan masa", languageHelp: "Tarikh, e-mel dan panduan menggunakan pilihan peribadi ini.",
    preferredLanguage: "Bahasa pilihan", timeZone: "Zon waktu", assignedTeam: "Pasukan yang ditugaskan", chooseTeam: "Pilih pasukan yang ditugaskan", teamHelp: "Sahkan pasukan dan skop yang telah ditetapkan oleh pentadbir anda. Pilihan ini tidak memberikan akses baharu.", notifications: "Pemberitahuan",
    notificationsHelp: "Bukti aliran kerja dalam aplikasi sentiasa tersedia. Pilihan e-mel dan peringatan diurus dalam Pemberitahuan.",
    inApp: "Pemberitahuan dalam aplikasi", inAppHelp: "Sentiasa aktif supaya tugasan, keputusan, penghantaran dan pengecualian kekal tersedia.",
    email: "Pemberitahuan e-mel", emailNotificationsHelp: "Hantar kemas kini transaksi penting ke e-mel akaun anda.",
    policy: "Saya mengesahkan butiran ini dan menerima dasar Axora yang diperlukan.", policyHelp: "Jangan kongsi akaun, kata laluan, sesi atau pautan jemputan anda.",
    next: "Seterusnya: ruang kerja Axora anda", audit: "Perubahan direkodkan dalam jejak audit.", saveContinue: "Simpan dan teruskan", save: "Simpan profil",
  },
} as const;

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAccountLifecycleSession();
  const [profile, imagePolicy] = await Promise.all([
    getMyProfile(actor),
    actor.accountKind === "DELIVERY"
      ? getProfileImagePolicy(actor)
      : Promise.resolve({
          deliveryAgentPhotoRequired: false,
          retiredVersionRetentionDays: 30,
        }),
  ]);
  const copy = profileCopy[profile.preferredLocale];
  const search = await searchParams;
  const onboarding = !myProfileMeetsRequiredOnboarding(profile) || search.onboarding === "1";
  const error = typeof search.error === "string" ? search.error : undefined;
  const saved = typeof search.saved === "string" ? search.saved : undefined;
  const returnTo = safeInternalReturnPath(
    typeof search.returnTo === "string" ? search.returnTo : undefined,
    "/dashboard",
  );
  const teamValue = actor.roleAssignmentId ?? actor.role;
  const roleCopy = portalMessages(profile.preferredLocale).roles;
  const teamLabel = actor.isOwner
    ? roleCopy.PLATFORM_OWNER
    : roleCopy[actor.role] ?? roleCopy.SCOPED_USER;
  const continuityFields = <>
    <input type="hidden" name="onboarding" value={onboarding ? "true" : "false"} />
    <input type="hidden" name="returnTo" value={returnTo} />
  </>;

  const profileContent = <>
    <PageHeader
      eyebrow={onboarding ? copy.firstStep : copy.personalSettings}
      title={onboarding ? copy.onboardingTitle : copy.title}
      description={onboarding
        ? copy.onboardingDescription
        : copy.description}
    />

    {saved ? <div className="form-success profile-feedback" role="status"><CheckCircle2 size={18} />{copy.saved}</div> : null}
    {error && !error.startsWith("image-") ? <div className="form-alert profile-feedback" role="alert">{copy.invalid}</div> : null}

    <div className="profile-layout">
      <ProfileImageManager available={profile.avatarAvailable} email={profile.email} errorCode={error}
        locale={profile.preferredLocale} name={profile.displayName} onboarding={onboarding}
        removeAction={removeProfileImageAction}
        required={actor.accountKind === "DELIVERY" && imagePolicy.deliveryAgentPhotoRequired}
        returnTo={returnTo} savedState={saved} uploadAction={uploadProfileImageAction}
        version={profile.avatarVersion} />

      <form action={saveProfileAction} className="profile-form" aria-label={copy.formLabel}>
        {continuityFields}
        <header><UserRound size={21} /><div><h2>{copy.personal}</h2><p>{copy.personalHelp}</p></div></header>
        <div className="form-grid">
          <label>{copy.displayName}<input name="displayName" defaultValue={profile.displayName} minLength={2} maxLength={200} autoComplete="name" required /></label>
          <label>{copy.jobTitle}<input name="jobTitle" defaultValue={profile.jobTitle} maxLength={160} autoComplete="organization-title" placeholder={copy.jobExample} /></label>
          <InternationalPhoneInput defaultValue={profile.phone} label={copy.phone}
            locale={profile.preferredLocale} name="phone" />
          <label>{copy.accountEmail}<input value={profile.email} type="email" readOnly aria-describedby="profile-email-help" /><small id="profile-email-help">{copy.emailHelp}</small></label>
        </div>

        <header><Languages size={21} /><div><h2>{copy.languageTime}</h2><p>{copy.languageHelp}</p></div></header>
        <div className="form-grid">
          <label>{copy.preferredLanguage}<select name="preferredLocale" defaultValue={profile.preferredLocale}>{SUPPORTED_LOCALES.map((locale) => <option value={locale} key={locale}>{LOCALE_NAMES[locale].native}</option>)}</select></label>
          <label>{copy.timeZone}<select name="timezone" defaultValue={profile.timezone}>{timezones.includes(profile.timezone) ? null : <option value={profile.timezone}>{profile.timezone}</option>}{timezones.map((zone) => <option value={zone} key={zone}>{zone.replaceAll("_", " ")}</option>)}</select></label>
          {onboarding ? <label className="field-full first-use-team-field">{copy.assignedTeam}<select name="assignedTeam" defaultValue="" required><option value="" disabled>{copy.chooseTeam}</option><option value={teamValue}>{teamLabel}</option></select><small>{copy.teamHelp}</small></label> : null}
        </div>

        <header><BellRing size={21} /><div><h2>{copy.notifications}</h2><p>{copy.notificationsHelp}</p></div></header>
        <div className="preference-list">
          <label><input name="inAppNotifications" type="checkbox" checked disabled aria-describedby="profile-in-app-help" /><span><strong>{copy.inApp}</strong><small id="profile-in-app-help">{copy.inAppHelp}</small></span></label>
          <label><input name="emailNotifications" type="checkbox" defaultChecked={profile.emailNotifications} /><span><strong>{copy.email}</strong><small>{copy.emailNotificationsHelp}</small></span></label>
        </div>

        <label className="policy-confirmation">
          <input name="policyAccepted" type="checkbox" defaultChecked={myProfileMeetsRequiredOnboarding(profile)} required />
          <span><ShieldCheck size={18} /><span><strong>{copy.policy}</strong><small>{copy.policyHelp}</small></span></span>
        </label>

        <div className="profile-submit-row"><span>{onboarding ? copy.next : copy.audit}</span><button className="button button-primary" type="submit">{onboarding ? copy.saveContinue : copy.save}</button></div>
      </form>
    </div>
  </>;

  if (!onboarding) return profileContent;
  return <div className="first-use-gate" role="dialog" aria-modal="true" aria-label={copy.onboardingTitle}>
    <div className="first-use-gate-card" data-photo-required={actor.accountKind === "DELIVERY" && imagePolicy.deliveryAgentPhotoRequired ? "true" : "false"}>
      <div className="first-use-guide" aria-hidden="true"><Image src="/login-yeti.svg" alt="" width={92} height={92} priority /></div>
      {profileContent}
    </div>
  </div>;
}

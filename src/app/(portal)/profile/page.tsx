import { PageHeader } from "@/components/PageHeader";
import { requireAccountLifecycleSession } from "@/lib/auth";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "@/lib/i18n";
import { getMyProfile, myProfileMeetsRequiredOnboarding } from "@/lib/profile";
import { safeInternalReturnPath } from "@/lib/session-return";
import { BellRing, Camera, CheckCircle2, Languages, ShieldCheck, UserRound } from "lucide-react";
import Image from "next/image";
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
    preferredLanguage: "Preferred language", timeZone: "Time zone", notifications: "Notifications",
    notificationsHelp: "Choose where Axora sends relevant work updates. Individual event preferences remain available in Account.",
    inApp: "In-app notifications", inAppHelp: "Show assignments, decisions, delivery events, and exceptions in Axora.",
    email: "Email notifications", emailNotificationsHelp: "Send important transactional updates to your account email.",
    policy: "I confirm these details and accept the required Axora policies.", policyHelp: "Do not share your account, password, session, or invitation links.",
    next: "Next: a short tutorial for your role", audit: "Changes are recorded in the audit trail.", saveContinue: "Save and continue", save: "Save profile",
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
    preferredLanguage: "اللغة المفضلة", timeZone: "المنطقة الزمنية", notifications: "الإشعارات",
    notificationsHelp: "اختر أين ترسل Axora تحديثات العمل المهمة. تتوفر تفضيلات الأحداث المنفردة في الحساب.",
    inApp: "إشعارات داخل التطبيق", inAppHelp: "إظهار المهام والقرارات وأحداث التسليم والاستثناءات في Axora.",
    email: "إشعارات البريد الإلكتروني", emailNotificationsHelp: "إرسال التحديثات المهمة إلى بريد حسابك.",
    policy: "أؤكد صحة هذه البيانات وأوافق على سياسات Axora المطلوبة.", policyHelp: "لا تشارك حسابك أو كلمة مرورك أو جلستك أو روابط الدعوة.",
    next: "التالي: دليل قصير مخصص لدورك", audit: "تُسجل التغييرات في سجل التدقيق.", saveContinue: "حفظ ومتابعة", save: "حفظ الملف",
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
    preferredLanguage: "Bahasa pilihan", timeZone: "Zon waktu", notifications: "Pemberitahuan",
    notificationsHelp: "Pilih tempat Axora menghantar kemas kini kerja yang berkaitan. Pilihan acara individu tersedia dalam Akaun.",
    inApp: "Pemberitahuan dalam aplikasi", inAppHelp: "Paparkan tugasan, keputusan, acara penghantaran dan pengecualian dalam Axora.",
    email: "Pemberitahuan e-mel", emailNotificationsHelp: "Hantar kemas kini transaksi penting ke e-mel akaun anda.",
    policy: "Saya mengesahkan butiran ini dan menerima dasar Axora yang diperlukan.", policyHelp: "Jangan kongsi akaun, kata laluan, sesi atau pautan jemputan anda.",
    next: "Seterusnya: tutorial ringkas untuk peranan anda", audit: "Perubahan direkodkan dalam jejak audit.", saveContinue: "Simpan dan teruskan", save: "Simpan profil",
  },
} as const;

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAccountLifecycleSession();
  const profile = await getMyProfile(actor);
  const copy = profileCopy[profile.preferredLocale];
  const search = await searchParams;
  const onboarding = !myProfileMeetsRequiredOnboarding(profile) || search.onboarding === "1";
  const error = typeof search.error === "string" ? search.error : undefined;
  const saved = typeof search.saved === "string" ? search.saved : undefined;
  const returnTo = safeInternalReturnPath(
    typeof search.returnTo === "string" ? search.returnTo : undefined,
    "/dashboard",
  );
  const continuityFields = <>
    <input type="hidden" name="onboarding" value={onboarding ? "true" : "false"} />
    <input type="hidden" name="returnTo" value={returnTo} />
  </>;

  return <>
    <PageHeader
      eyebrow={onboarding ? copy.firstStep : copy.personalSettings}
      title={onboarding ? copy.onboardingTitle : copy.title}
      description={onboarding
        ? copy.onboardingDescription
        : copy.description}
    />

    {saved ? <div className="form-success profile-feedback" role="status"><CheckCircle2 size={18} />{copy.saved}</div> : null}
    {error ? <div className="form-alert profile-feedback" role="alert">{error === "invalid-image"
      ? copy.invalidImage
      : copy.invalid}</div> : null}

    <div className="profile-layout">
      <aside className="profile-identity" aria-label={copy.profileImage}>
        <div className="profile-avatar-large">
          {profile.avatarAvailable
            ? <Image src="/api/profile/avatar" width={128} height={128} alt={copy.imageAlt(profile.displayName)} unoptimized />
            : <span aria-hidden="true">{profile.displayName.trim().split(/\s+/).slice(0, 2).map((name) => name[0]).join("").toUpperCase()}</span>}
        </div>
        <div><strong>{profile.displayName}</strong><span>{profile.email}</span></div>
        <form action={uploadProfileImageAction} className="avatar-upload-form">
          {continuityFields}
          <label className="button button-secondary"><Camera size={16} />{copy.choosePhoto}<input className="sr-only" name="avatar" type="file" accept="image/png,image/jpeg,image/webp" required /></label>
          <button className="button button-primary" type="submit">{copy.upload}</button>
        </form>
        {profile.avatarAvailable ? <form action={removeProfileImageAction}>{continuityFields}<button className="text-button" type="submit">{copy.removePhoto}</button></form> : null}
        <small>{copy.imageHelp}</small>
      </aside>

      <form action={saveProfileAction} className="profile-form" aria-label={copy.formLabel}>
        {continuityFields}
        <header><UserRound size={21} /><div><h2>{copy.personal}</h2><p>{copy.personalHelp}</p></div></header>
        <div className="form-grid">
          <label>{copy.displayName}<input name="displayName" defaultValue={profile.displayName} minLength={2} maxLength={200} autoComplete="name" required /></label>
          <label>{copy.jobTitle}<input name="jobTitle" defaultValue={profile.jobTitle} maxLength={160} autoComplete="organization-title" placeholder={copy.jobExample} /></label>
          <label>{copy.phone}<input name="phone" defaultValue={profile.phone} maxLength={40} autoComplete="tel" inputMode="tel" /></label>
          <label>{copy.accountEmail}<input value={profile.email} type="email" readOnly aria-describedby="profile-email-help" /><small id="profile-email-help">{copy.emailHelp}</small></label>
        </div>

        <header><Languages size={21} /><div><h2>{copy.languageTime}</h2><p>{copy.languageHelp}</p></div></header>
        <div className="form-grid">
          <label>{copy.preferredLanguage}<select name="preferredLocale" defaultValue={profile.preferredLocale}>{SUPPORTED_LOCALES.map((locale) => <option value={locale} key={locale}>{LOCALE_NAMES[locale].native}</option>)}</select></label>
          <label>{copy.timeZone}<select name="timezone" defaultValue={profile.timezone}>{timezones.includes(profile.timezone) ? null : <option value={profile.timezone}>{profile.timezone}</option>}{timezones.map((zone) => <option value={zone} key={zone}>{zone.replaceAll("_", " ")}</option>)}</select></label>
        </div>

        <header><BellRing size={21} /><div><h2>{copy.notifications}</h2><p>{copy.notificationsHelp}</p></div></header>
        <div className="preference-list">
          <label><input name="inAppNotifications" type="checkbox" defaultChecked={profile.inAppNotifications} /><span><strong>{copy.inApp}</strong><small>{copy.inAppHelp}</small></span></label>
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
}

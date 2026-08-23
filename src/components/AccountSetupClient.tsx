"use client";

import {
  completeAccountSetupAction,
  inspectAccountSetupTokenAction,
  type AccountSetupCompletionState,
  type AccountSetupInspectionState,
} from "@/app/account/setup/actions";
import { AccountSetupSubmitButton } from "@/components/AccountSetupSubmitButton";
import { PasswordField } from "@/components/PasswordField";
import { KeyRound, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { LOCALE_NAMES, persistBrowserLocale, type SupportedLocale } from "@/lib/i18n";
import {
  useActionState,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INITIAL_COMPLETION_STATE: AccountSetupCompletionState = { status: "idle" };

interface FragmentLocation {
  hash: string;
  pathname: string;
}

interface FragmentHistory {
  state: unknown;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

/**
 * Read the bearer token once and remove the complete fragment before any
 * network action. The clean history entry deliberately drops query values too.
 */
export function readAndClearSetupTokenFragment(
  location: FragmentLocation,
  history: FragmentHistory,
) {
  const fragment = location.hash.startsWith("#")
    ? location.hash.slice(1)
    : location.hash;

  try {
    history.replaceState(history.state, "", location.pathname);
  } catch {
    return "";
  }

  const parameters = new URLSearchParams(fragment);
  const tokens = parameters.getAll("token");
  if (parameters.size !== 1 || tokens.length !== 1 || !TOKEN_PATTERN.test(tokens[0])) {
    return "";
  }
  return tokens[0];
}

type ValidInspection = Extract<AccountSetupInspectionState, { status: "valid" }>;
type SetupView =
  | { status: "loading" }
  | {
    status: "missing" | "malformed" | "invalid" | "expired" | "used"
      | "revoked" | "unavailable";
  }
  | { status: "valid"; rawToken: string; invitation: ValidInspection };

const setupCopy = {
  en: {
    accountSetup: "Account setup", retryTitle: "Try again shortly",
    missingTitle: "Open your invitation email", invalidTitle: "Invitation unavailable",
    expiredTitle: "Invitation expired", usedTitle: "Setup already completed", revokedTitle: "Invitation replaced",
    unavailable: "Axora could not verify this setup link right now.", missing: "This page needs the private link from your invitation email.",
    invalid: "This setup link is invalid or unavailable.", expired: "This setup invitation has expired.",
    used: "This setup invitation has already been completed.", revoked: "A newer invitation has replaced this setup link.",
    unavailableHelp: "Reopen the newest invitation email in a moment. If the problem continues, contact your administrator.",
    invalidHelp: "Open the newest invitation directly from your email, or ask your administrator to resend it.",
    usedHelp: "Sign in with the password you created. If you did not complete setup, contact your administrator.",
    setupHelp: "Contact Axora", signIn: "Return to sign in", welcome: (company: string) => `Welcome to ${company}`,
    createTitle: "Create your password", password: "New password", confirm: "Confirm password",
    displayName: "Your display name", role: "Assigned access", terms: "I accept the Axora account terms.", privacy: "I acknowledge the Axora privacy notice.",
    showPassword: "Show password", hidePassword: "Hide password",
    tooShort: "Use at least 15 Unicode characters.", tooLong: "Use no more than 128 Unicode characters.",
    requirements: "Use 15–128 Unicode characters. Spaces are allowed; there is no uppercase, number, or symbol rule. Paste and password managers are supported. Do not reuse a password from another service.",
    expires: (date: string) => `This link expires ${date} and stops working immediately after your password is saved.`,
    checking: "Checking your invitation", checkingHelp: "Please wait while Axora verifies this private link.",
    create: "Create password", saving: "Saving password…", feedback: "Securing your Axora account…",
    errors: { password_mismatch: "The passwords do not match. Enter the same password in both fields.", invalid_link: "This setup link is invalid, expired, or has already been used.", password_policy: "Use 15–128 Unicode characters. Your password is never truncated.", policy_required: "Accept the account terms and privacy notice to activate this invitation.", save_failed: "Axora could not save your password. Your link was not used; please try again." },
  },
  ar: {
    accountSetup: "إعداد الحساب", retryTitle: "حاول بعد قليل",
    missingTitle: "افتح رسالة الدعوة", invalidTitle: "الدعوة غير متاحة",
    expiredTitle: "انتهت صلاحية الدعوة", usedTitle: "اكتمل إعداد الحساب", revokedTitle: "تم استبدال الدعوة",
    unavailable: "تعذر على Axora التحقق من رابط الإعداد الآن.", missing: "تحتاج هذه الصفحة إلى الرابط الخاص الموجود في رسالة الدعوة.",
    invalid: "رابط الإعداد غير صالح أو غير متاح.", expired: "انتهت صلاحية دعوة الإعداد هذه.",
    used: "تم إكمال دعوة الإعداد هذه مسبقًا.", revoked: "استبدلت دعوة أحدث رابط الإعداد هذا.",
    unavailableHelp: "افتح أحدث رسالة دعوة بعد قليل. إذا استمرت المشكلة، تواصل مع مديرك.",
    invalidHelp: "افتح أحدث دعوة مباشرة من بريدك أو اطلب من مديرك إعادة إرسالها.",
    usedHelp: "سجّل الدخول بكلمة المرور التي أنشأتها. إذا لم تُكمل الإعداد، فتواصل مع مديرك.",
    setupHelp: "تواصل مع Axora", signIn: "العودة إلى تسجيل الدخول", welcome: (company: string) => `مرحبًا بك في ${company}`,
    createTitle: "أنشئ كلمة مرورك", password: "كلمة المرور الجديدة", confirm: "تأكيد كلمة المرور",
    displayName: "اسم العرض", role: "الوصول المسند", terms: "أوافق على شروط حساب Axora.", privacy: "أقر بإشعار خصوصية Axora.",
    showPassword: "إظهار كلمة المرور", hidePassword: "إخفاء كلمة المرور",
    tooShort: "استخدم 15 محرف Unicode على الأقل.", tooLong: "استخدم 128 محرف Unicode كحد أقصى.",
    requirements: "استخدم من 15 إلى 128 محرف Unicode. المسافات مسموحة، ولا يُشترط حرف كبير أو رقم أو رمز. اللصق ومديرو كلمات المرور مدعومون. لا تعِد استخدام كلمة مرور من خدمة أخرى.",
    expires: (date: string) => `تنتهي صلاحية هذا الرابط في ${date} ويتوقف فورًا بعد حفظ كلمة المرور.`,
    checking: "جارٍ التحقق من دعوتك", checkingHelp: "يرجى الانتظار بينما تتحقق Axora من هذا الرابط الخاص.",
    create: "إنشاء كلمة المرور", saving: "جارٍ حفظ كلمة المرور…", feedback: "جارٍ تأمين حسابك في Axora…",
    errors: { password_mismatch: "كلمتا المرور غير متطابقتين. أدخل كلمة المرور نفسها في الحقلين.", invalid_link: "رابط الإعداد غير صالح أو منتهي الصلاحية أو سبق استخدامه.", password_policy: "استخدم من 15 إلى 128 محرف Unicode. لا يتم اقتطاع كلمة المرور.", policy_required: "وافق على شروط الحساب وإشعار الخصوصية لتفعيل الدعوة.", save_failed: "تعذر على Axora حفظ كلمة المرور. لم يُستخدم الرابط؛ حاول مرة أخرى." },
  },
  ms: {
    accountSetup: "Persediaan akaun", retryTitle: "Cuba lagi sebentar lagi",
    missingTitle: "Buka e-mel jemputan anda", invalidTitle: "Jemputan tidak tersedia",
    expiredTitle: "Jemputan telah tamat tempoh", usedTitle: "Persediaan telah selesai", revokedTitle: "Jemputan telah diganti",
    unavailable: "Axora tidak dapat mengesahkan pautan persediaan ini sekarang.", missing: "Halaman ini memerlukan pautan peribadi daripada e-mel jemputan anda.",
    invalid: "Pautan persediaan ini tidak sah atau tidak tersedia.", expired: "Jemputan persediaan ini telah tamat tempoh.",
    used: "Jemputan persediaan ini telah pun diselesaikan.", revoked: "Jemputan yang lebih baharu telah menggantikan pautan persediaan ini.",
    unavailableHelp: "Buka semula e-mel jemputan terbaharu sebentar lagi. Jika masalah berterusan, hubungi pentadbir anda.",
    invalidHelp: "Buka jemputan terbaharu terus daripada e-mel, atau minta pentadbir anda menghantarnya semula.",
    usedHelp: "Log masuk dengan kata laluan yang anda cipta. Jika anda tidak melengkapkan persediaan, hubungi pentadbir anda.",
    setupHelp: "Hubungi Axora", signIn: "Kembali ke log masuk", welcome: (company: string) => `Selamat datang ke ${company}`,
    createTitle: "Cipta kata laluan anda", password: "Kata laluan baharu", confirm: "Sahkan kata laluan",
    displayName: "Nama paparan anda", role: "Akses yang ditugaskan", terms: "Saya menerima terma akaun Axora.", privacy: "Saya mengakui notis privasi Axora.",
    showPassword: "Tunjukkan kata laluan", hidePassword: "Sembunyikan kata laluan",
    tooShort: "Gunakan sekurang-kurangnya 15 aksara Unicode.", tooLong: "Gunakan tidak lebih daripada 128 aksara Unicode.",
    requirements: "Gunakan 15–128 aksara Unicode. Ruang dibenarkan; tiada syarat huruf besar, nombor atau simbol. Tampal dan pengurus kata laluan disokong. Jangan guna semula kata laluan daripada perkhidmatan lain.",
    expires: (date: string) => `Pautan ini tamat tempoh pada ${date} dan berhenti berfungsi serta-merta selepas kata laluan disimpan.`,
    checking: "Menyemak jemputan anda", checkingHelp: "Sila tunggu sementara Axora mengesahkan pautan peribadi ini.",
    create: "Cipta kata laluan", saving: "Menyimpan kata laluan…", feedback: "Melindungi akaun Axora anda…",
    errors: { password_mismatch: "Kata laluan tidak sepadan. Masukkan kata laluan yang sama dalam kedua-dua medan.", invalid_link: "Pautan persediaan ini tidak sah, telah tamat tempoh atau telah digunakan.", password_policy: "Gunakan 15–128 aksara Unicode. Kata laluan anda tidak dipendekkan.", policy_required: "Terima terma akaun dan notis privasi untuk mengaktifkan jemputan ini.", save_failed: "Axora tidak dapat menyimpan kata laluan anda. Pautan belum digunakan; sila cuba lagi." },
  },
} as const;

function formatExpiry(value: string, locale: SupportedLocale) {
  return new Intl.DateTimeFormat({ en: "en-MY", ar: "ar-MY", ms: "ms-MY" }[locale], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function SetupMessageCard({ status, locale }: {
  status: Exclude<SetupView["status"], "loading" | "valid">;
  locale: SupportedLocale;
}) {
  const copy = setupCopy[locale];
  const unavailable = status === "unavailable";
  const title = unavailable ? copy.retryTitle
    : status === "missing" ? copy.missingTitle
      : status === "expired" ? copy.expiredTitle
        : status === "used" ? copy.usedTitle
          : status === "revoked" ? copy.revokedTitle
            : copy.invalidTitle;
  const message = unavailable ? copy.unavailable
    : status === "missing" ? copy.missing
      : status === "expired" ? copy.expired
        : status === "used" ? copy.used
          : status === "revoked" ? copy.revoked
            : copy.invalid;
  return (
    <article className="login-card" aria-labelledby="invalid-setup-title" lang={locale} dir={LOCALE_NAMES[locale].dir}>
      <div className="login-icon"><KeyRound size={24} /></div>
      <p className="eyebrow">{copy.accountSetup}</p>
      <h2 id="invalid-setup-title">
        {title}
      </h2>
      <div className="form-alert" role="alert">
        {message}
      </div>
      <p className="muted">
        {unavailable
          ? copy.unavailableHelp
          : status === "used" ? copy.usedHelp : copy.invalidHelp}
      </p>
      <div className="public-info-actions">
        <Link className="button button-secondary" href={`/${locale}/contact`}>{copy.setupHelp}</Link>
        <Link className="button button-primary" href="/login">{copy.signIn}</Link>
      </div>
    </article>
  );
}

function AccountSetupForm({
  invitation,
  rawToken,
}: {
  invitation: ValidInspection;
  rawToken: string;
}) {
  const locale = invitation.locale;
  const copy = setupCopy[locale];
  const action = useMemo(
    () => completeAccountSetupAction.bind(null, rawToken),
    [rawToken],
  );
  const [completion, formAction] = useActionState(
    action,
    INITIAL_COMPLETION_STATE,
  );

  return (
    <form
      className="login-card"
      action={formAction}
      aria-labelledby="account-setup-title"
      data-ux-silent="true"
      lang={locale}
      dir={LOCALE_NAMES[locale].dir}
    >
      <input name="locale" type="hidden" value={locale} />
      <div className="login-icon"><KeyRound size={24} /></div>
      <p className="eyebrow">{copy.welcome(invitation.companyName)}</p>
      <h2 id="account-setup-title">{copy.createTitle}</h2>
      <p className="muted">
        {invitation.recipientName} · {invitation.recipientEmail}
      </p>
      <p className="muted">{copy.role}: {invitation.jobTitle || invitation.role}</p>

      {completion.code ? (
        <div className="form-alert" role="alert" aria-live="polite">
          {copy.errors[completion.code]}
        </div>
      ) : null}

      <label>{copy.displayName}<input name="displayName" defaultValue={invitation.recipientName} minLength={2} maxLength={200} autoComplete="name" required disabled={completion.status === "invalid"} /></label>

      <PasswordField
        id="account-setup-password"
        name="password"
        label={copy.password}
        showLabel={copy.showPassword}
        hideLabel={copy.hidePassword}
        autoComplete="new-password"
        describedBy="password-requirements"
        disabled={completion.status === "invalid"}
        enforceNewPasswordPolicy
        tooShortMessage={copy.tooShort}
        tooLongMessage={copy.tooLong}
      />
      <PasswordField
        id="account-setup-password-confirmation"
        name="confirmPassword"
        label={copy.confirm}
        showLabel={copy.showPassword}
        hideLabel={copy.hidePassword}
        autoComplete="new-password"
        describedBy="password-requirements"
        disabled={completion.status === "invalid"}
        enforceNewPasswordPolicy
        tooShortMessage={copy.tooShort}
        tooLongMessage={copy.tooLong}
      />
      <p id="password-requirements" className="account-setup-requirements">
        {copy.requirements}
      </p>
      <label className="public-contact-consent"><input name="termsAccepted" type="checkbox" required disabled={completion.status === "invalid"} /><span>{copy.terms}</span></label>
      <label className="public-contact-consent"><input name="privacyAccepted" type="checkbox" required disabled={completion.status === "invalid"} /><span>{copy.privacy}</span></label>
      <AccountSetupSubmitButton disabled={completion.status === "invalid"} createLabel={copy.create} savingLabel={copy.saving} feedbackLabel={copy.feedback} />
      <p className="demo-note">
        {copy.expires(formatExpiry(invitation.expiresAt, locale))}
      </p>
    </form>
  );
}

export function AccountSetupClient({ initialLocale = "en" }: { initialLocale?: SupportedLocale }) {
  const [view, setView] = useState<SetupView>({ status: "loading" });
  const tokenRef = useRef<string | undefined>(undefined);
  const inspectionRef = useRef<Promise<AccountSetupInspectionState> | undefined>(undefined);

  useLayoutEffect(() => {
    let active = true;
    if (tokenRef.current === undefined) {
      const fragmentPresent = window.location.hash.length > 0;
      tokenRef.current = readAndClearSetupTokenFragment(window.location, window.history);
      if (!tokenRef.current) {
        inspectionRef.current = Promise.resolve({
          status: fragmentPresent ? "malformed" : "missing",
        });
      }
    }
    const rawToken = tokenRef.current;
    inspectionRef.current ??= rawToken
      ? inspectAccountSetupTokenAction(rawToken)
      : Promise.resolve({ status: "missing" });

    void inspectionRef.current
      .then((inspection) => {
        if (!active) return;
        if (inspection.status === "valid" && rawToken) {
          persistBrowserLocale(inspection.locale);
          setView({ status: "valid", rawToken, invitation: inspection });
          return;
        }
        tokenRef.current = "";
        setView({
          status: inspection.status === "valid" ? "invalid" : inspection.status,
        });
      })
      .catch(() => {
        if (!active) return;
        tokenRef.current = "";
        setView({ status: "unavailable" });
      });

    return () => {
      active = false;
    };
  }, []);

  if (view.status === "loading") {
    const copy = setupCopy[initialLocale];
    return (
      <article className="login-card" role="status" aria-live="polite" lang={initialLocale} dir={LOCALE_NAMES[initialLocale].dir}>
        <div className="login-icon"><LoaderCircle className="ux-spin" size={24} /></div>
        <p className="eyebrow">{copy.accountSetup}</p>
        <h2>{copy.checking}</h2>
        <p className="muted">{copy.checkingHelp}</p>
      </article>
    );
  }
  if (view.status !== "valid") {
    return <SetupMessageCard status={view.status} locale={initialLocale} />;
  }
  return <AccountSetupForm invitation={view.invitation} rawToken={view.rawToken} />;
}

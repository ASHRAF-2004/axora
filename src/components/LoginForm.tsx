"use client";

import { loginAction } from "@/app/login/actions";
import type { SupportedLocale } from "@/lib/i18n";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";

const loginCopy = {
  en: {
    checking: "Checking your account securely",
    private: "Your password stays private",
    retry: "Check your details and try again",
    success: "Password created successfully",
    finding: "Finding your Axora workspace",
    guide: "Secure sign in",
    feedback: "Signing in to Axora…",
    connecting: "Connecting to Axora…",
    signIn: "Sign in",
    welcome: "Welcome back",
    title: "Sign in to Axora",
    subtitle: "Use your assigned account.",
    resetComplete:
      "Your password was changed and prior sessions were ended. Sign in with the new password.",
    setupComplete:
      "Your password is ready. Sign in with your new credentials.",
    error:
      "The email or password is incorrect. If your account is new, use the private setup link in your invitation email first.",
    email: "Email",
    password: "Password",
    hidePassword: "Hide password",
    showPassword: "Show password",
    manager: "Paste and password managers are supported.",
    forgot: "Forgot password?",
    demo: "Local demo only:",
    demoHelp:
      "the filled credentials are disabled when the server is deployed.",
  },
  ar: {
    checking: "جارٍ التحقق من حسابك بأمان",
    private: "تبقى كلمة مرورك خاصة",
    retry: "راجع بياناتك وحاول مرة أخرى",
    success: "تم إنشاء كلمة المرور بنجاح",
    finding: "جارٍ العثور على مساحة عملك في Axora",
    guide: "تسجيل دخول آمن",
    feedback: "جارٍ تسجيل الدخول إلى Axora…",
    connecting: "جارٍ الاتصال بـ Axora…",
    signIn: "تسجيل الدخول",
    welcome: "مرحبًا بعودتك",
    title: "تسجيل الدخول إلى Axora",
    subtitle: "استخدم الحساب المخصص لك.",
    resetComplete:
      "تم تغيير كلمة المرور وإنهاء الجلسات السابقة. سجّل الدخول بكلمة المرور الجديدة.",
    setupComplete:
      "كلمة مرورك جاهزة. سجّل الدخول ببياناتك الجديدة.",
    error:
      "البريد الإلكتروني أو كلمة المرور غير صحيحين. إذا كان حسابك جديدًا، استخدم أولًا رابط الإعداد الخاص في رسالة الدعوة.",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    hidePassword: "إخفاء كلمة المرور",
    showPassword: "إظهار كلمة المرور",
    manager: "يدعم الحقل اللصق ومديري كلمات المرور.",
    forgot: "هل نسيت كلمة المرور؟",
    demo: "عرض محلي فقط:",
    demoHelp:
      "يتم تعطيل بيانات الدخول المعبأة عند نشر الخادم.",
  },
  ms: {
    checking: "Menyemak akaun anda dengan selamat",
    private: "Kata laluan anda kekal peribadi",
    retry: "Semak butiran anda dan cuba lagi",
    success: "Kata laluan berjaya dicipta",
    finding: "Mencari ruang kerja Axora anda",
    guide: "Log masuk selamat",
    feedback: "Melog masuk ke Axora…",
    connecting: "Menyambung ke Axora…",
    signIn: "Log masuk",
    welcome: "Selamat kembali",
    title: "Log masuk ke Axora",
    subtitle: "Gunakan akaun yang ditetapkan kepada anda.",
    resetComplete:
      "Kata laluan anda telah ditukar dan sesi terdahulu ditamatkan. Log masuk dengan kata laluan baharu.",
    setupComplete:
      "Kata laluan anda sudah sedia. Log masuk dengan kelayakan baharu.",
    error:
      "E-mel atau kata laluan tidak betul. Jika akaun anda baharu, gunakan dahulu pautan persediaan peribadi dalam e-mel jemputan.",
    email: "E-mel",
    password: "Kata laluan",
    hidePassword: "Sembunyikan kata laluan",
    showPassword: "Tunjukkan kata laluan",
    manager: "Tampal dan pengurus kata laluan disokong.",
    forgot: "Lupa kata laluan?",
    demo: "Demo setempat sahaja:",
    demoHelp:
      "kelayakan yang diisi dilumpuhkan apabila pelayan digunakan.",
  },
} as const;

type GuideFocus = "email" | "password" | null;

function LoginGuide({
  focus,
  emailLength,
  passwordVisible,
  error,
  success,
  locale,
}: {
  focus: GuideFocus;
  emailLength: number;
  passwordVisible: boolean;
  error: boolean;
  success: boolean;
  locale: SupportedLocale;
}) {
  const { pending } = useFormStatus();
  const copy = loginCopy[locale];
  const glance =
    focus === "email"
      ? Math.min(5, Math.max(-5, (emailLength % 11) - 5))
      : 0;
  const coveringEyes = focus === "password";
  const leftArmTransform = coveringEyes
    ? "translate(0 0) rotate(0 72 116)"
    : "translate(-34 54) rotate(-28 72 116)";
  const rightArmTransform = coveringEyes
    ? passwordVisible
      ? "translate(14 4) rotate(18 148 116)"
      : "translate(0 0) rotate(0 148 116)"
    : "translate(34 54) rotate(28 148 116)";
  const status = pending
    ? copy.checking
    : error
      ? copy.retry
      : success
        ? copy.success
        : focus === "password" && !passwordVisible
          ? copy.private
          : focus === "email"
            ? copy.finding
            : copy.guide;

  return (
    <div
      className="login-guide"
      aria-hidden="true"
      style={{
        minHeight: 190,
        display: "grid",
        placeItems: "center",
        alignContent: "center",
        margin: "-20px 0 8px",
      }}
    >
      <svg
        viewBox="0 0 220 180"
        role="presentation"
        style={{ width: 210, height: 172, overflow: "visible" }}
      >
        <defs>
          <linearGradient id="axora-guide-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#dcecf7" />
          </linearGradient>
          <linearGradient id="axora-guide-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#d9f3ff" />
            <stop offset="1" stopColor="#a9ddf3" />
          </linearGradient>
          <clipPath id="axora-guide-clip">
            <circle cx="110" cy="88" r="78" />
          </clipPath>
        </defs>

        <circle
          cx="110"
          cy="88"
          r="78"
          fill="url(#axora-guide-bg)"
          stroke="#217093"
          strokeWidth="3"
        />

        <g clipPath="url(#axora-guide-clip)">
          <ellipse
            cx="110"
            cy="158"
            rx="67"
            ry="42"
            fill="url(#axora-guide-body)"
            stroke="#3a5e77"
            strokeWidth="3"
          />
          <circle
            cx="110"
            cy="91"
            r="51"
            fill="url(#axora-guide-body)"
            stroke="#3a5e77"
            strokeWidth="3"
          />
          <circle cx="60" cy="91" r="13" fill="#ddf1fa" stroke="#3a5e77" strokeWidth="3" />
          <circle cx="160" cy="91" r="13" fill="#ddf1fa" stroke="#3a5e77" strokeWidth="3" />

          <path
            d="M74 54C80 36 94 27 110 27C126 27 140 36 146 54C136 46 126 43 110 43C94 43 84 46 74 54Z"
            fill="#ffffff"
            stroke="#3a5e77"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path
            d="M82 55L91 44L98 55L110 41L120 55L132 45L139 58"
            fill="none"
            stroke="#3a5e77"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <g
            style={{
              transform: `translateX(${glance}px)`,
              transformOrigin: "center",
              transition: "transform 180ms ease, opacity 180ms ease",
              opacity: coveringEyes && !passwordVisible ? 0.2 : 1,
            }}
          >
            <ellipse cx="90" cy="84" rx="11" ry="14" fill="#ffffff" />
            <ellipse cx="130" cy="84" rx="11" ry="14" fill="#ffffff" />
            <circle cx="90" cy="86" r="5" fill="#0b2d52" />
            <circle cx="130" cy="86" r="5" fill="#0b2d52" />
            <circle cx="88" cy="84" r="1.5" fill="#ffffff" />
            <circle cx="128" cy="84" r="1.5" fill="#ffffff" />
          </g>

          <path
            d="M105 98L110 104L115 98"
            fill="none"
            stroke="#3a5e77"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={
              error
                ? "M94 121C104 112 116 112 126 121"
                : success
                  ? "M92 115C102 128 118 128 128 115"
                  : "M96 118C105 124 115 124 124 118"
            }
            fill="none"
            stroke={error ? "#b91c1c" : success ? "#15803d" : "#3a5e77"}
            strokeWidth="4"
            strokeLinecap="round"
            style={{ transition: "all 220ms ease" }}
          />

          <g
            style={{
              transform: leftArmTransform,
              transformOrigin: "72px 116px",
              transition:
                "transform 420ms cubic-bezier(.2,.85,.25,1.15)",
            }}
          >
            <path
              d="M32 158C42 139 54 123 72 116C82 112 91 116 93 126C95 135 89 142 79 143C68 144 59 150 51 163"
              fill="#ffffff"
              stroke="#3a5e77"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle cx="82" cy="126" r="11" fill="#ddf1fa" stroke="#3a5e77" strokeWidth="3" />
          </g>

          <g
            style={{
              transform: rightArmTransform,
              transformOrigin: "148px 116px",
              transition:
                "transform 420ms cubic-bezier(.2,.85,.25,1.15)",
            }}
          >
            <path
              d="M188 158C178 139 166 123 148 116C138 112 129 116 127 126C125 135 131 142 141 143C152 144 161 150 169 163"
              fill="#ffffff"
              stroke="#3a5e77"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle cx="138" cy="126" r="11" fill="#ddf1fa" stroke="#3a5e77" strokeWidth="3" />
          </g>
        </g>
      </svg>
      <span
        style={{
          marginTop: -6,
          color: "#64748b",
          fontSize: 12,
          fontWeight: 750,
          letterSpacing: ".02em",
        }}
      >
        {status}
      </span>
    </div>
  );
}

function LoginButton({ locale }: { locale: SupportedLocale }) {
  const { pending } = useFormStatus();
  const copy = loginCopy[locale];

  return (
    <button
      className="button button-primary button-full"
      type="submit"
      disabled={pending}
      aria-busy={pending}
      data-feedback-label={copy.feedback}
    >
      {pending ? (
        <>
          <LoaderCircle className="ux-spin" size={18} />
          {copy.connecting}
        </>
      ) : (
        copy.signIn
      )}
    </button>
  );
}

export function LoginForm({
  error,
  setupComplete,
  resetComplete,
  demo,
  demoEmail,
  demoPassword,
  locale = "en",
}: {
  error: boolean;
  setupComplete: boolean;
  resetComplete: boolean;
  demo: boolean;
  demoEmail?: string;
  demoPassword?: string;
  locale?: SupportedLocale;
}) {
  const initialEmail = demo ? (demoEmail ?? "") : "";
  const initialPassword = demo ? (demoPassword ?? "") : "";
  const [focus, setFocus] = useState<GuideFocus>(null);
  const [emailValue, setEmailValue] = useState(initialEmail);
  const [passwordValue, setPasswordValue] = useState(initialPassword);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const copy = loginCopy[locale];

  return (
    <form
      action={loginAction}
      className="login-card"
      data-feedback-label={copy.feedback}
    >
      <LoginGuide
        focus={focus}
        emailLength={emailValue.length}
        passwordVisible={passwordVisible}
        error={error}
        success={setupComplete || resetComplete}
        locale={locale}
      />

      <p className="eyebrow">{copy.welcome}</p>
      <h2>{copy.title}</h2>
      <p className="muted">{copy.subtitle}</p>

      {setupComplete || resetComplete ? (
        <div className="form-success" role="status">
          {resetComplete ? copy.resetComplete : copy.setupComplete}
        </div>
      ) : null}

      {error ? (
        <div className="form-alert" role="alert">
          {copy.error}
        </div>
      ) : null}

      <label htmlFor="loginEmail">
        {copy.email}
        <input
          id="loginEmail"
          name="email"
          type="email"
          maxLength={254}
          value={emailValue}
          autoComplete="username"
          onChange={(event) => setEmailValue(event.target.value)}
          onFocus={() => setFocus("email")}
          onBlur={() => setFocus(null)}
          required
        />
      </label>

      <div className="field-control">
        <label htmlFor="loginPassword">{copy.password}</label>
        <span className="password-input-wrap">
          <input
            id="loginPassword"
            name="password"
            type={passwordVisible ? "text" : "password"}
            value={passwordValue}
            autoComplete="current-password"
            onChange={(event) => setPasswordValue(event.target.value)}
            onFocus={() => setFocus("password")}
            onBlur={() => setFocus(null)}
            required
          />
          <button
            type="button"
            className="password-visibility"
            aria-label={
              passwordVisible ? copy.hidePassword : copy.showPassword
            }
            aria-pressed={passwordVisible}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setPasswordVisible((visible) => !visible);
              setFocus("password");
            }}
          >
            {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </span>
      </div>

      <div className="login-form-meta">
        <span>{copy.manager}</span>
        <Link href="/account/forgot-password">{copy.forgot}</Link>
      </div>

      <LoginButton locale={locale} />

      {demo ? (
        <p className="demo-note">
          <strong>{copy.demo}</strong> {copy.demoHelp}
        </p>
      ) : null}
    </form>
  );
}

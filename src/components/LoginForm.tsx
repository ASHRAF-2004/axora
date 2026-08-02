"use client";

import { loginAction } from "@/app/login/actions";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import type { SupportedLocale } from "@/lib/i18n";

const loginCopy = {
  en: {
    checking: "Checking your account securely", private: "Your password stays private", retry: "Check your details and try again",
    success: "Password created successfully", finding: "Finding your Axora workspace", guide: "Secure sign in",
    feedback: "Signing in to Axora…", connecting: "Connecting to Axora…", signIn: "Sign in", welcome: "Welcome back",
    title: "Sign in to Axora", subtitle: "Use your assigned account.", resetComplete: "Your password was changed and prior sessions were ended. Sign in with the new password.",
    setupComplete: "Your password is ready. Sign in with your new credentials.", error: "The email or password is incorrect. If your account is new, use the private setup link in your invitation email first.",
    email: "Email", password: "Password", hidePassword: "Hide password", showPassword: "Show password",
    manager: "Paste and password managers are supported.", forgot: "Forgot password?", demo: "Local demo only:", demoHelp: "the filled credentials are disabled when the server is deployed.",
  },
  ar: {
    checking: "جارٍ التحقق من حسابك بأمان", private: "تبقى كلمة مرورك خاصة", retry: "راجع بياناتك وحاول مرة أخرى",
    success: "تم إنشاء كلمة المرور بنجاح", finding: "جارٍ العثور على مساحة عملك في Axora", guide: "تسجيل دخول آمن",
    feedback: "جارٍ تسجيل الدخول إلى Axora…", connecting: "جارٍ الاتصال بـ Axora…", signIn: "تسجيل الدخول", welcome: "مرحبًا بعودتك",
    title: "تسجيل الدخول إلى Axora", subtitle: "استخدم الحساب المخصص لك.", resetComplete: "تم تغيير كلمة المرور وإنهاء الجلسات السابقة. سجّل الدخول بكلمة المرور الجديدة.",
    setupComplete: "كلمة مرورك جاهزة. سجّل الدخول ببياناتك الجديدة.", error: "البريد الإلكتروني أو كلمة المرور غير صحيحين. إذا كان حسابك جديدًا، استخدم أولًا رابط الإعداد الخاص في رسالة الدعوة.",
    email: "البريد الإلكتروني", password: "كلمة المرور", hidePassword: "إخفاء كلمة المرور", showPassword: "إظهار كلمة المرور",
    manager: "يدعم الحقل اللصق ومديري كلمات المرور.", forgot: "هل نسيت كلمة المرور؟", demo: "عرض محلي فقط:", demoHelp: "يتم تعطيل بيانات الدخول المعبأة عند نشر الخادم.",
  },
  ms: {
    checking: "Menyemak akaun anda dengan selamat", private: "Kata laluan anda kekal peribadi", retry: "Semak butiran anda dan cuba lagi",
    success: "Kata laluan berjaya dicipta", finding: "Mencari ruang kerja Axora anda", guide: "Log masuk selamat",
    feedback: "Melog masuk ke Axora…", connecting: "Menyambung ke Axora…", signIn: "Log masuk", welcome: "Selamat kembali",
    title: "Log masuk ke Axora", subtitle: "Gunakan akaun yang ditetapkan kepada anda.", resetComplete: "Kata laluan anda telah ditukar dan sesi terdahulu ditamatkan. Log masuk dengan kata laluan baharu.",
    setupComplete: "Kata laluan anda sudah sedia. Log masuk dengan kelayakan baharu.", error: "E-mel atau kata laluan tidak betul. Jika akaun anda baharu, gunakan dahulu pautan persediaan peribadi dalam e-mel jemputan.",
    email: "E-mel", password: "Kata laluan", hidePassword: "Sembunyikan kata laluan", showPassword: "Tunjukkan kata laluan",
    manager: "Tampal dan pengurus kata laluan disokong.", forgot: "Lupa kata laluan?", demo: "Demo setempat sahaja:", demoHelp: "kelayakan yang diisi dilumpuhkan apabila pelayan digunakan.",
  },
} as const;

function LoginGuide({
  focus,
  emailLength,
  passwordVisible,
  error,
  success,
  locale,
}: {
  focus: "email" | "password" | null;
  emailLength: number;
  passwordVisible: boolean;
  error: boolean;
  success: boolean;
  locale: SupportedLocale;
}) {
  const { pending } = useFormStatus();
  const glance = focus === "email" ? Math.min(4, Math.max(-4, (emailLength % 9) - 4)) : 0;
  const state = pending ? "loading" : error ? "error" : success ? "success" : focus === "password" ? (passwordVisible ? "peek" : "private") : focus === "email" ? "email" : "idle";
  return <div className="login-guide" data-state={state} aria-hidden="true">
    <svg viewBox="0 0 180 126" role="presentation">
      <defs>
        <linearGradient id="axora-login-face" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#0B2D52"/><stop offset="1" stopColor="#164E7A"/></linearGradient>
      </defs>
      <path className="login-guide-orbit" d="M24 61C35 20 145 15 160 60C171 96 128 116 84 112C44 109 13 94 24 61Z" fill="none" stroke="#E8A33D" strokeWidth="3" strokeDasharray="4 8" />
      <rect x="43" y="27" width="94" height="76" rx="27" fill="url(#axora-login-face)" />
      <path d="M72 27V17M108 27V17" stroke="#E8A33D" strokeWidth="4" strokeLinecap="round" />
      <circle cx="72" cy="16" r="5" fill="#E8A33D"/><circle cx="108" cy="16" r="5" fill="#E8A33D"/>
      <g className="login-guide-eyes" style={{ transform: `translateX(${glance}px)` }}>
        <ellipse cx="73" cy="59" rx="9" ry="10" fill="#fff" />
        <ellipse cx="107" cy="59" rx="9" ry="10" fill="#fff" />
        <circle cx="73" cy="60" r="4" fill="#0B2D52" />
        <circle cx="107" cy="60" r="4" fill="#0B2D52" />
      </g>
      <g className="login-guide-lids">
        <path d="M62 59Q73 51 84 59" fill="none" stroke="#E8A33D" strokeWidth="4" strokeLinecap="round" />
        <path d="M96 59Q107 51 118 59" fill="none" stroke="#E8A33D" strokeWidth="4" strokeLinecap="round" />
      </g>
      <path className="login-guide-mouth login-guide-mouth-neutral" d="M80 82H100" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <path className="login-guide-mouth login-guide-mouth-success" d="M77 79Q90 91 103 79" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <path className="login-guide-mouth login-guide-mouth-error" d="M77 87Q90 75 103 87" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <path className="login-guide-shield" d="M139 74L151 69L163 74V84C163 94 157 100 151 103C145 100 139 94 139 84Z" fill="#fff" stroke="#E8A33D" strokeWidth="3" />
      <path d="M147 85L150 88L156 80" fill="none" stroke="#0B2D52" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <span>{pending ? loginCopy[locale].checking : focus === "password" && !passwordVisible ? loginCopy[locale].private : error ? loginCopy[locale].retry : success ? loginCopy[locale].success : focus === "email" ? loginCopy[locale].finding : loginCopy[locale].guide}</span>
  </div>;
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
  const [focus, setFocus] = useState<"email" | "password" | null>(null);
  const [emailLength, setEmailLength] = useState(demoEmail?.length ?? 0);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const copy = loginCopy[locale];
  return (
    <form
      action={loginAction}
      className="login-card"
      data-feedback-label={copy.feedback}
    >
      <LoginGuide focus={focus} emailLength={emailLength} passwordVisible={passwordVisible} error={error} success={setupComplete || resetComplete} locale={locale} />
      <p className="eyebrow">{copy.welcome}</p>
      <h2>{copy.title}</h2>
      <p className="muted">{copy.subtitle}</p>

      {setupComplete || resetComplete ? (
        <div className="form-success" role="status">
          {resetComplete
            ? copy.resetComplete
            : copy.setupComplete}
        </div>
      ) : null}

      {error ? (
        <div className="form-alert" role="alert">
          {copy.error}
        </div>
      ) : null}

      <label>
        {copy.email}
        <input
          name="email"
          type="email"
          defaultValue={demo ? demoEmail : ""}
          autoComplete="username"
          onFocus={() => setFocus("email")}
          onBlur={() => setFocus(null)}
          onChange={(event) => setEmailLength(event.target.value.length)}
          required
        />
      </label>

      <div className="field-control">
        <label htmlFor="login-password">{copy.password}</label>
        <span className="password-input-wrap">
          <input
            id="login-password"
            name="password"
            type={passwordVisible ? "text" : "password"}
            defaultValue={demo ? demoPassword : ""}
            autoComplete="current-password"
            onFocus={() => setFocus("password")}
            onBlur={() => setFocus(null)}
            required
          />
          <button type="button" className="password-visibility" aria-label={passwordVisible ? copy.hidePassword : copy.showPassword} aria-pressed={passwordVisible} onMouseDown={(event) => event.preventDefault()} onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}</button>
        </span>
      </div>

      <div className="login-form-meta"><span>{copy.manager}</span><Link href="/account/forgot-password">{copy.forgot}</Link></div>

      <LoginButton locale={locale} />

      {demo ? (
        <p className="demo-note">
          <strong>{copy.demo}</strong> {copy.demoHelp}
        </p>
      ) : null}
    </form>
  );
}

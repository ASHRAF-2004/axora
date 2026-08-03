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
    <svg viewBox="0 0 220 150" role="presentation">
      <defs>
        <linearGradient id="axora-yeti-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f8fbff" />
          <stop offset="1" stopColor="#e4eef7" />
        </linearGradient>
        <linearGradient id="axora-yeti-glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E8A33D" stopOpacity="0.12" />
          <stop offset="1" stopColor="#E8A33D" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g transform="translate(110 28)">
        <ellipse cx="0" cy="82" rx="56" ry="20" fill="url(#axora-yeti-glow)" />
      </g>
      <circle cx="58" cy="39" r="9" fill="#fff" stroke="#c6d8eb" strokeWidth="2" />
      <circle cx="162" cy="40" r="9" fill="#fff" stroke="#c6d8eb" strokeWidth="2" />
      <path d="M58 43C57 44 56 47 56 50C56 58 62 64 70 64C78 64 84 58 84 50C84 47 83 44 82 43" fill="none" stroke="#7f9eb8" strokeWidth="3" strokeLinecap="round" />
      <path d="M162 43C161 44 160 47 160 50C160 58 166 64 174 64C182 64 188 58 188 50C188 47 187 44 186 43" fill="none" stroke="#7f9eb8" strokeWidth="3" strokeLinecap="round" />

      <ellipse cx="110" cy="85" rx="76" ry="42" fill="url(#axora-yeti-body)" stroke="#c7d9ed" strokeWidth="3" />
      <circle cx="66" cy="82" r="22" fill="#ffffff" stroke="#d5e4f1" strokeWidth="3" />
      <circle cx="154" cy="82" r="22" fill="#ffffff" stroke="#d5e4f1" strokeWidth="3" />
      <circle cx="110" cy="82" r="30" fill="#ffffff" stroke="#d5e4f1" strokeWidth="3" />

      <circle cx="70" cy="80" r="16" fill="#fff" />
      <circle cx="150" cy="80" r="16" fill="#fff" />
      <circle cx="150" cy="80" r="13" fill="#f3f8fd" stroke="#bfd2e3" strokeWidth="2" />
      <circle cx="70" cy="80" r="13" fill="#f3f8fd" stroke="#bfd2e3" strokeWidth="2" />

      <g className="login-guide-eyes" style={{ transform: `translateX(${glance}px)` }}>
        <circle cx="70" cy="81" r="4.8" fill="#0B2D52" />
        <circle cx="150" cy="81" r="4.8" fill="#0B2D52" />
      </g>
      <g className="login-guide-lids" opacity="0.9">
        <path d="M58 83C58 74 62 70 70 70" fill="none" stroke="#5c7690" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M140 70C148 70 152 74 152 83" fill="none" stroke="#5c7690" strokeWidth="3.5" strokeLinecap="round" />
      </g>

      <path className="login-guide-mouth login-guide-mouth-neutral" d="M96 102C110 108 130 108 142 102" fill="none" stroke="#334f6c" strokeWidth="4.3" strokeLinecap="round" />
      <path className="login-guide-mouth login-guide-mouth-success" d="M96 108C110 100 130 100 142 108" fill="none" stroke="#15803d" strokeWidth="4.3" strokeLinecap="round" />
      <path className="login-guide-mouth login-guide-mouth-error" d="M96 98C110 106 130 106 142 98" fill="none" stroke="#b91c1c" strokeWidth="4.3" strokeLinecap="round" />

      <path d="M90 40C93 34 98 31 104 30M126 30C132 31 137 34 140 40" fill="none" stroke="#2d4966" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M110 108C103 116 115 116 110 108" fill="none" stroke="#334f6c" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M66 72Q64 68 68 66" fill="none" stroke="#f2a8bb" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M154 72Q156 68 152 66" fill="none" stroke="#f2a8bb" strokeWidth="2.5" strokeLinecap="round" />
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

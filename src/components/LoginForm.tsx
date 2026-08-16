"use client";

import { loginAction } from "@/app/login/actions";
import type { SupportedLocale } from "@/lib/i18n";
import { LOCALE_NAMES, persistBrowserLocale, SUPPORTED_LOCALES } from "@/lib/i18n";
import {
  browserReturnPath,
  mergeStoredReturnHash,
  safeInternalReturnPath,
  type SessionReturnReason,
} from "@/lib/session-return";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import styles from "./LoginForm.module.css";

const loginCopy = {
  en: {
    title: "Sign in to Axora",
    welcome: "Secure access to your procurement workspace.",
    email: "Email",
    password: "Password",
    emailHint: "email@domain.com",
    logIn: "Log in",
    signIn: "Sign in",
    connecting: "Logging in…",
    show: "Show",
    hide: "Hide",
    showPassword: "Show password",
    hidePassword: "Hide password",
    feedback: "Signing in to Axora…",
    setupComplete:
      "Your password is ready. Sign in with your new credentials.",
    resetComplete:
      "Your password was changed and prior sessions were ended. Sign in with the new password.",
    error:
      "The email or password is incorrect. If your account is new, use the private setup link in your invitation email first.",
    required:
      "Sign in to continue on the page you requested.",
    expired:
      "Your secure session ended. Sign in again to return to your previous page.",
    accessChanged:
      "Your access changed. Sign in again and Axora will open the newest route permitted for your role.",
    forgot: "Forgot password?",
    register: "Register your company / request access",
    inviteOnly: "Employee accounts are invitation-only and are created by an authorized Axora or company administrator.",
    language: "Language",
    support: "Contact support",
  },
  ar: {
    title: "تسجيل الدخول إلى Axora",
    welcome: "وصول آمن إلى مساحة عمل المشتريات.",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    emailHint: "email@domain.com",
    logIn: "تسجيل الدخول",
    signIn: "تسجيل الدخول",
    connecting: "جارٍ تسجيل الدخول…",
    show: "إظهار",
    hide: "إخفاء",
    showPassword: "إظهار كلمة المرور",
    hidePassword: "إخفاء كلمة المرور",
    feedback: "جارٍ تسجيل الدخول إلى Axora…",
    setupComplete: "كلمة مرورك جاهزة. سجّل الدخول ببياناتك الجديدة.",
    resetComplete:
      "تم تغيير كلمة المرور وإنهاء الجلسات السابقة. سجّل الدخول بكلمة المرور الجديدة.",
    error:
      "البريد الإلكتروني أو كلمة المرور غير صحيحين. إذا كان حسابك جديدًا، استخدم أولًا رابط الإعداد الخاص في رسالة الدعوة.",
    required: "سجّل الدخول للمتابعة في الصفحة التي طلبتها.",
    expired:
      "انتهت جلستك الآمنة. سجّل الدخول مرة أخرى للعودة إلى صفحتك السابقة.",
    accessChanged:
      "تغيّر نطاق وصولك. سجّل الدخول مرة أخرى وسيفتح Axora أحدث مسار مسموح لدورك.",
    forgot: "هل نسيت كلمة المرور؟",
    register: "سجّل شركتك / اطلب الوصول",
    inviteOnly: "حسابات الموظفين متاحة بالدعوة فقط وينشئها مسؤول مخول في Axora أو الشركة.",
    language: "اللغة",
    support: "التواصل مع الدعم",
  },
  ms: {
    title: "Log masuk ke Axora",
    welcome: "Akses selamat ke ruang kerja perolehan anda.",
    email: "E-mel",
    password: "Kata laluan",
    emailHint: "email@domain.com",
    logIn: "Log masuk",
    signIn: "Log masuk",
    connecting: "Sedang log masuk…",
    show: "Tunjuk",
    hide: "Sembunyi",
    showPassword: "Tunjukkan kata laluan",
    hidePassword: "Sembunyikan kata laluan",
    feedback: "Melog masuk ke Axora…",
    setupComplete:
      "Kata laluan anda sudah sedia. Log masuk dengan kelayakan baharu.",
    resetComplete:
      "Kata laluan anda telah ditukar dan sesi terdahulu ditamatkan. Log masuk dengan kata laluan baharu.",
    error:
      "E-mel atau kata laluan tidak betul. Jika akaun anda baharu, gunakan dahulu pautan persediaan peribadi dalam e-mel jemputan.",
    required: "Log masuk untuk meneruskan pada halaman yang anda minta.",
    expired:
      "Sesi selamat anda telah tamat. Log masuk semula untuk kembali ke halaman sebelumnya.",
    accessChanged:
      "Akses anda telah berubah. Log masuk semula dan Axora akan membuka laluan terbaharu yang dibenarkan untuk peranan anda.",
    forgot: "Lupa kata laluan?",
    register: "Daftar syarikat anda / minta akses",
    inviteOnly: "Akaun pekerja adalah melalui jemputan sahaja dan dicipta oleh pentadbir Axora atau syarikat yang dibenarkan.",
    language: "Bahasa",
    support: "Hubungi sokongan",
  },
} as const;

function LoginButton({ locale }: { locale: SupportedLocale }) {
  const { pending } = useFormStatus();
  const copy = loginCopy[locale];

  return (
    <button
      id="login"
      className={styles.loginButton}
      type="submit"
      disabled={pending}
      aria-busy={pending}
      aria-label={copy.signIn}
      data-feedback-label={copy.feedback}
    >
      {pending ? copy.connecting : copy.logIn}
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
  returnTo,
  reason,
  locale = "en",
}: {
  error: boolean;
  setupComplete: boolean;
  resetComplete: boolean;
  demo: boolean;
  demoEmail?: string;
  demoPassword?: string;
  returnTo?: string;
  reason?: SessionReturnReason;
  locale?: SupportedLocale;
}) {
  const copy = loginCopy[locale];
  const initialEmail = demo ? (demoEmail ?? "") : "";
  const initialPassword = demo ? (demoPassword ?? "") : "";
  const [emailValue, setEmailValue] = useState(initialEmail);
  const [passwordValue, setPasswordValue] = useState(initialPassword);
  const [passwordVisible, setPasswordVisible] = useState(false);

  const mergedReturnTo = useMemo(() => {
    // Merge any browser-stored fragment into the same server-provided path.
    // A direct login must never inherit a previous person's tab path.
    if (!returnTo) return "/dashboard";
    return mergeStoredReturnHash(
      returnTo,
      browserReturnPath(),
      "/dashboard",
    );
  }, [returnTo]);

  const feedback = useMemo(() => {
    if (error) return { kind: "error" as const, message: copy.error };
    if (resetComplete) {
      return { kind: "success" as const, message: copy.resetComplete };
    }
    if (setupComplete) {
      return { kind: "success" as const, message: copy.setupComplete };
    }
    if (reason === "expired") {
      return { kind: "error" as const, message: copy.expired };
    }
    if (reason === "access-changed") {
      return { kind: "error" as const, message: copy.accessChanged };
    }
    if (reason === "required") {
      return { kind: "success" as const, message: copy.required };
    }
    return null;
  }, [copy, error, reason, resetComplete, setupComplete]);

  return (
    <form
      action={loginAction}
      className={styles.form}
      aria-label={copy.title}
      data-feedback-label={copy.feedback}
    >
      <div className={styles.brand}>
        <Image src="/brand/axora-logo-light-background.png" width={174} height={49} alt="Axora" priority unoptimized />
        <h1>{copy.title}</h1>
        <p>{copy.welcome}</p>
      </div>
      <input
        name="returnTo"
        type="hidden"
        defaultValue={safeInternalReturnPath(mergedReturnTo, "/dashboard")}
      />

      {feedback ? (
        <div
          className={
            feedback.kind === "error" ? styles.error : styles.success
          }
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </div>
      ) : null}

      <div
        className={styles.inputGroup}
      >
        <label htmlFor="loginEmail" id="loginEmailLabel">
          {copy.email}
        </label>
        <input
          type="email"
          id="loginEmail"
          name="email"
          maxLength={254}
          value={emailValue}
          autoComplete="username"
          spellCheck={false}
          onChange={(event) => {
            setEmailValue(event.target.value);
          }}
          required
        />
        <p className={styles.helper}>{copy.emailHint}</p>
      </div>

      <div className={styles.inputGroup}>
        <label htmlFor="loginPassword" id="loginPasswordLabel">
          {copy.password}
        </label>
        <input
          id="loginPassword"
          name="password"
          type={passwordVisible ? "text" : "password"}
          value={passwordValue}
          onChange={(event) => setPasswordValue(event.target.value)}
          autoComplete="current-password"
          required
        />
        <button
          id="showPasswordToggle"
          className={styles.showPasswordToggle}
          type="button"
          aria-label={
            passwordVisible ? copy.hidePassword : copy.showPassword
          }
          aria-pressed={passwordVisible}
          onClick={() => {
            setPasswordVisible((visible) => !visible);
          }}
        >
          <span className={styles.indicator} aria-hidden="true">
            <span
              className={passwordVisible ? styles.checkVisible : undefined}
            />
          </span>
          <span>{passwordVisible ? copy.hide : copy.show}</span>
        </button>
      </div>

      <div className={styles.inputGroup}>
        <LoginButton locale={locale} />
      </div>
      <div className={styles.inputGroup}>
        <Link href="/account/forgot-password">{copy.forgot}</Link>
        <Link href={`/${locale}/contact`}>{copy.register}</Link>
        <p className={styles.helper}>{copy.inviteOnly}</p>
        <label>
          {copy.language}
          <select
            value={locale}
            onChange={(event) => {
              persistBrowserLocale(event.target.value as SupportedLocale);
              window.location.reload();
            }}
          >
            {SUPPORTED_LOCALES.map((option) => <option key={option} value={option}>{LOCALE_NAMES[option].native}</option>)}
          </select>
        </label>
        <Link href={`/${locale}/contact`}>{copy.support}</Link>
      </div>
    </form>
  );
}

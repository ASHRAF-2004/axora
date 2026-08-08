"use client";

import { loginAction } from "@/app/login/actions";
import type { SupportedLocale } from "@/lib/i18n";
import {
  browserReturnPath,
  mergeStoredReturnHash,
  safeInternalReturnPath,
  type SessionReturnReason,
} from "@/lib/session-return";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import styles from "./LoginForm.module.css";
import { YetiGuide, type GuideFocus } from "./login/YetiGuide";

const loginCopy = {
  en: {
    title: "Sign in to Axora",
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
  },
  ar: {
    title: "تسجيل الدخول إلى Axora",
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
  },
  ms: {
    title: "Log masuk ke Axora",
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
  const emailRef = useRef<HTMLInputElement | null>(null);
  const [focus, setFocus] = useState<GuideFocus>(null);
  const [emailValue, setEmailValue] = useState(initialEmail);
  const [passwordValue, setPasswordValue] = useState(initialPassword);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [caretIndex, setCaretIndex] = useState(initialEmail.length);
  const [returnToValue, setReturnToValue] = useState(() => (
    safeInternalReturnPath(returnTo, "/dashboard")
  ));

  useEffect(() => {
    const stored = browserReturnPath();
    const recovered = returnTo
      ? mergeStoredReturnHash(returnTo, stored, "/dashboard")
      : safeInternalReturnPath(stored, "/dashboard");
    setReturnToValue(recovered);
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

  const syncCaret = (input: HTMLInputElement) => {
    setCaretIndex(input.selectionEnd ?? input.value.length);
  };

  const keepPasswordFocus = () => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.id === "loginPassword" ||
          active.id === "showPasswordToggle")
      ) {
        setFocus("password");
      } else {
        setFocus(null);
      }
    }, 100);
  };

  return (
    <form
      action={loginAction}
      className={styles.form}
      aria-label={copy.title}
      data-feedback-label={copy.feedback}
    >
      <h1 className={styles.srOnly}>{copy.title}</h1>
      <input name="returnTo" type="hidden" value={returnToValue} />

      <YetiGuide
        focus={focus}
        emailValue={emailValue}
        caretIndex={caretIndex}
        emailRef={emailRef}
        passwordVisible={passwordVisible}
        error={error}
        success={setupComplete || resetComplete}
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
        className={`${styles.inputGroup} ${styles.inputGroup1} ${
          focus === "email" || emailValue ? styles.focusWithText : ""
        }`}
      >
        <label htmlFor="loginEmail" id="loginEmailLabel">
          {copy.email}
        </label>
        <input
          ref={emailRef}
          type="email"
          id="loginEmail"
          name="email"
          maxLength={254}
          value={emailValue}
          autoComplete="username"
          onChange={(event) => {
            setEmailValue(event.target.value);
            syncCaret(event.target);
          }}
          onSelect={(event) => syncCaret(event.currentTarget)}
          onClick={(event) => syncCaret(event.currentTarget)}
          onKeyUp={(event) => syncCaret(event.currentTarget)}
          onFocus={(event) => {
            setFocus("email");
            syncCaret(event.currentTarget);
          }}
          onBlur={() => setFocus(null)}
          required
        />
        <p className={styles.helper}>{copy.emailHint}</p>
      </div>

      <div className={`${styles.inputGroup} ${styles.inputGroup2}`}>
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
          onFocus={() => setFocus("password")}
          onBlur={keepPasswordFocus}
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
          onFocus={() => setFocus("password")}
          onBlur={keepPasswordFocus}
          onClick={() => {
            setPasswordVisible((visible) => !visible);
            setFocus("password");
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

      <div className={`${styles.inputGroup} ${styles.inputGroup3}`}>
        <LoginButton locale={locale} />
      </div>
    </form>
  );
}

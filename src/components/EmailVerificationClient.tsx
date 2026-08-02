"use client";

import {
  verifyEmailTokenAction,
  type EmailVerificationState,
} from "@/app/account/verify-email/actions";
import { readAndClearSecurityTokenFragment } from "@/lib/security-token-fragment";
import { accountLifecycleMessages } from "@/lib/account-lifecycle-i18n";
import { LOCALE_NAMES, persistBrowserLocale, type SupportedLocale } from "@/lib/i18n";
import { CheckCircle2, LoaderCircle, MailCheck, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";

type VerificationView = EmailVerificationState | { status: "loading" };

export function EmailVerificationClient({ initialLocale }: { initialLocale: SupportedLocale }) {
  const [view, setView] = useState<VerificationView>({ status: "loading" });
  const [locale, setLocale] = useState(initialLocale);
  const tokenRef = useRef<string | undefined>(undefined);
  const verificationRef = useRef<Promise<EmailVerificationState> | undefined>(undefined);
  useLayoutEffect(() => {
    let active = true;
    if (tokenRef.current === undefined) {
      tokenRef.current = readAndClearSecurityTokenFragment(window.location, window.history);
    }
    verificationRef.current ??= tokenRef.current
      ? verifyEmailTokenAction(tokenRef.current)
      : Promise.resolve({ status: "invalid" });
    void verificationRef.current.then((result) => {
      if (!active) return;
      if (result.locale) {
        setLocale(result.locale);
        persistBrowserLocale(result.locale);
      }
      tokenRef.current = "";
      setView(result);
    }).catch(() => {
      if (!active) return;
      tokenRef.current = "";
      setView({ status: "unavailable" });
    });
    return () => { active = false; };
  }, []);

  if (view.status === "loading") {
    const copy = accountLifecycleMessages(locale).verify;
    return (
      <article className="login-card" role="status" aria-live="polite" lang={locale} dir={LOCALE_NAMES[locale].dir}>
        <div className="login-icon"><LoaderCircle className="ux-spin" size={24} /></div>
        <p className="eyebrow">{copy.verification}</p>
        <h2>{copy.checkingTitle}</h2>
        <p className="muted">{copy.checkingBody}</p>
      </article>
    );
  }
  const verified = view.status === "verified";
  const unavailable = view.status === "unavailable";
  const copy = accountLifecycleMessages(locale);
  return (
    <article className="login-card" aria-labelledby="verification-result-title" lang={locale} dir={LOCALE_NAMES[locale].dir}>
      <div className="login-icon">
        {verified ? <CheckCircle2 size={24} /> : unavailable ? <ShieldAlert size={24} /> : <MailCheck size={24} />}
      </div>
      <p className="eyebrow">{copy.verify.verification}</p>
      <h2 id="verification-result-title">
        {verified ? copy.verify.verifiedTitle : unavailable ? copy.verify.unavailableTitle : copy.verify.invalidTitle}
      </h2>
      <div className={verified ? "form-success" : "form-alert"} role={verified ? "status" : "alert"}>
        {verified
          ? copy.verify.verifiedBody
          : unavailable
            ? copy.verify.unavailableBody
            : copy.verify.invalidBody}
      </div>
      <div className="public-info-actions">
        <Link className="button button-secondary" href="/login">{copy.common.signIn}</Link>
        <Link className="button button-primary" href="/account">{copy.common.accountSecurity}</Link>
      </div>
    </article>
  );
}

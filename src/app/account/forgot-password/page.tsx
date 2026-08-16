import { Brand } from "@/components/Brand";
import { KeyRound, MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requestPasswordResetAction } from "./actions";
import { accountLifecycleMessages } from "@/lib/account-lifecycle-i18n";
import { isSupportedLocale, LOCALE_NAMES, SUPPORTED_LOCALES } from "@/lib/i18n";
import { requestLocaleDecision } from "@/lib/locale-server";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Request a private Axora password-reset link.",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [search, decision] = await Promise.all([searchParams, requestLocaleDecision()]);
  const requested = search.requested === "1";
  const queryLocale = typeof search.locale === "string" && isSupportedLocale(search.locale)
    ? search.locale
    : undefined;
  const locale = queryLocale ?? decision.locale;
  const copy = accountLifecycleMessages(locale);

  return (
    <main className="simple-auth-page" lang={locale} dir={LOCALE_NAMES[locale].dir}>
      <section className="simple-auth-wrap">
        <Link className="simple-auth-brand" href={`/${locale}`} aria-label="Axora"><Brand /></Link>
        <article className="login-card" aria-labelledby="forgot-password-title">
          <div className="login-icon">{requested ? <MailCheck size={24} /> : <KeyRound size={24} />}</div>
          <p className="eyebrow">{copy.forgot.eyebrow}</p>
          <h2 id="forgot-password-title">{requested ? copy.forgot.requestedTitle : copy.forgot.requestTitle}</h2>
          {requested ? (
            <>
              <div className="form-success" role="status">
                {copy.forgot.genericSuccess}
              </div>
              <p className="muted">
                {copy.forgot.requestedHelp}
              </p>
              <div className="public-info-actions">
                <Link className="button button-secondary" href="/account/forgot-password">{copy.forgot.anotherAddress}</Link>
                <Link className="button button-primary" href="/login">{copy.common.signIn}</Link>
              </div>
            </>
          ) : (
            <form action={requestPasswordResetAction} data-ux-silent="true">
              <p className="muted">{copy.forgot.emailHelp}</p>
              <label>
                {copy.forgot.emailLabel}
                <input name="email" type="email" autoComplete="email" inputMode="email" spellCheck={false} maxLength={254} required />
              </label>
              <label>
                {copy.forgot.languageLabel}
                <select name="locale" defaultValue={locale}>
                  {SUPPORTED_LOCALES.map((option) => (
                    <option key={option} value={option}>{LOCALE_NAMES[option].native}</option>
                  ))}
                </select>
              </label>
              <button className="button button-primary button-full" type="submit">{copy.forgot.submit}</button>
              <p className="demo-note">{copy.forgot.privacyNote}</p>
            </form>
          )}
        </article>
      </section>
    </main>
  );
}

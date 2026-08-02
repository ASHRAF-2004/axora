import { Brand } from "@/components/Brand";
import { EmailVerificationClient } from "@/components/EmailVerificationClient";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { requestLocaleDecision } from "@/lib/locale-server";
import { accountLifecycleMessages } from "@/lib/account-lifecycle-i18n";
import { LOCALE_NAMES } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Verify email",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function VerifyEmailPage() {
  const { locale } = await requestLocaleDecision();
  const copy = accountLifecycleMessages(locale);
  return (
    <main className="login-shell account-setup-shell" lang={locale} dir={LOCALE_NAMES[locale].dir}>
      <section className="login-story">
        <div className="login-brand"><Brand /></div>
        <div>
          <span className="pilot-chip"><ShieldCheck size={15} /> {copy.verify.verification}</span>
          <h1>{copy.verify.storyTitle}</h1>
          <p>{copy.verify.storyBody}</p>
          <ul className="feature-list">
            {copy.verify.benefits.map((benefit) => <li key={benefit}><ShieldCheck /> {benefit}</li>)}
          </ul>
        </div>
        <small>{copy.common.operations}</small>
      </section>
      <section className="login-panel"><EmailVerificationClient initialLocale={locale} /></section>
    </main>
  );
}

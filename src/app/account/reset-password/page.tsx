import { Brand } from "@/components/Brand";
import { PasswordResetClient } from "@/components/PasswordResetClient";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { requestLocaleDecision } from "@/lib/locale-server";
import { accountLifecycleMessages } from "@/lib/account-lifecycle-i18n";
import { LOCALE_NAMES } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function ResetPasswordPage() {
  const { locale } = await requestLocaleDecision();
  const copy = accountLifecycleMessages(locale);
  return (
    <main className="login-shell account-setup-shell" lang={locale} dir={LOCALE_NAMES[locale].dir}>
      <section className="login-story">
        <div className="login-brand"><Brand /></div>
        <div>
          <span className="pilot-chip"><ShieldCheck size={15} /> {copy.reset.privateRecovery}</span>
          <h1>{copy.reset.storyTitle}</h1>
          <p>{copy.reset.storyBody}</p>
          <ul className="feature-list">
            {copy.reset.benefits.map((benefit) => <li key={benefit}><ShieldCheck /> {benefit}</li>)}
          </ul>
        </div>
        <small>{copy.common.operations}</small>
      </section>
      <section className="login-panel"><PasswordResetClient initialLocale={locale} /></section>
    </main>
  );
}

import { Brand } from "@/components/Brand";
import { ArrowLeft, KeyRound, LifeBuoy, LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { accountLifecycleMessages } from "@/lib/account-lifecycle-i18n";
import { LOCALE_NAMES } from "@/lib/i18n";
import { requestLocaleDecision } from "@/lib/locale-server";

export const metadata: Metadata = {
  title: "Account setup help",
  description: "Help with an Axora account invitation and password setup link.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function supportAddress() {
  const configured = process.env.AXORA_EMAIL_REPLY_TO?.trim().toLowerCase();
  return configured && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configured)
    ? configured
    : "support@axora.management";
}

export default async function AccountSetupHelpPage() {
  const supportEmail = supportAddress();
  const { locale } = await requestLocaleDecision();
  const copy = accountLifecycleMessages(locale);

  return (
    <main className="login-shell public-info-shell" lang={locale} dir={LOCALE_NAMES[locale].dir}>
      <section className="login-story">
        <div className="login-brand"><Brand /></div>
        <div>
          <span className="pilot-chip"><LifeBuoy size={15} /> {copy.help.chip}</span>
          <h1>{copy.help.storyTitle}</h1>
          <p>{copy.help.storyBody}</p>
        </div>
        <small>{copy.common.operations}</small>
      </section>

      <section className="login-panel public-info-panel">
        <article className="login-card public-info-card" aria-labelledby="setup-help-title">
          <div className="login-icon"><KeyRound size={24} /></div>
          <p className="eyebrow">{copy.help.eyebrow}</p>
          <h2 id="setup-help-title">{copy.help.title}</h2>
          <p className="muted">{copy.help.intro}</p>

          <section className="public-info-section" aria-labelledby="link-help-title">
            <h3 id="link-help-title">{copy.help.linkTitle}</h3>
            <ul>
              {copy.help.linkPoints.map((point) => <li key={point}>{point}</li>)}
            </ul>
          </section>

          <section className="public-info-section" aria-labelledby="password-help-title">
            <h3 id="password-help-title">{copy.help.passwordTitle}</h3>
            <ul>
              {copy.help.passwordPoints.map((point) => <li key={point}>{point}</li>)}
            </ul>
          </section>

          <div className="callout public-info-callout" role="note">
            <strong><LockKeyhole size={16} /> {copy.help.privacyTitle}</strong>
            <p>
              {copy.help.privacyBeforeEmail}{" "}
              <a className="table-link" href={`mailto:${supportEmail}`}>{supportEmail}</a>.
            </p>
          </div>

          <nav className="public-info-actions" aria-label={copy.help.linksLabel}>
            <Link className="button button-secondary" href="/account/setup">
              <ArrowLeft size={16} /> {copy.help.setup}
            </Link>
            <Link className="button button-primary" href="/login">{copy.common.signIn}</Link>
          </nav>
        </article>
      </section>
    </main>
  );
}

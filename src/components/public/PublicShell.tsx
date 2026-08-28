import { LogIn } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/Brand";
import { LOCALE_NAMES, publicMessages, type SupportedLocale } from "@/lib/i18n";
import { AppearanceSelector } from "./AppearanceSelector";
import { LanguagePreference } from "./LanguagePreference";
import { PublicMobileMenu } from "./PublicMobileMenu";
import { PublicSkipLink } from "./PublicSkipLink";

interface PublicShellProps {
  locale: SupportedLocale;
  detectedLocale: SupportedLocale;
  showLanguagePrompt: boolean;
  children: ReactNode;
}

export function PublicShell({ locale, detectedLocale, showLanguagePrompt, children }: PublicShellProps) {
  const messages = publicMessages(locale);
  const prefix = `/${locale}`;
  const navigation = [
    { href: prefix, label: messages.nav.home },
    { href: `${prefix}/how-it-works`, label: messages.nav.how },
    { href: `${prefix}/procurement-process`, label: messages.nav.process },
    { href: `${prefix}/solutions-by-role`, label: messages.nav.roles },
    { href: `${prefix}/security-and-privacy`, label: messages.nav.security },
    { href: `${prefix}/about`, label: messages.nav.about },
  ];

  return (
    <div className="public-site" lang={locale} dir={LOCALE_NAMES[locale].dir}>
      <PublicSkipLink>{messages.skipToContent}</PublicSkipLink>
      <header className="public-header">
        <div className="public-header-inner">
          <Link className="public-brand" href={prefix} aria-label={`${messages.nav.home} - Axora`}>
            <Brand size="header" />
          </Link>
          <nav className="public-desktop-nav" aria-label={messages.nav.primaryNavigation}>
            {navigation.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
          </nav>
          <div className="public-header-actions">
            <div className="public-desktop-appearance"><AppearanceSelector compact locale={locale} /></div>
            <LanguagePreference
              locale={locale}
              detectedLocale={detectedLocale}
              prompt={showLanguagePrompt}
              labels={messages.language}
              compact
            />
            <Link href={`${prefix}/contact`} className="public-contact-link">{messages.nav.contact}</Link>
            <Link href="/login" className="button button-primary public-login-link">
              <LogIn size={17} aria-hidden="true" />{messages.nav.login}
            </Link>
            <PublicMobileMenu
              navigation={navigation}
              navigationLabel={messages.nav.mobileNavigation}
              menuLabel={messages.nav.menu}
              contactHref={`${prefix}/contact`}
              contactLabel={messages.nav.contact}
              loginLabel={messages.nav.login}
              locale={locale}
            />
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>{children}</main>
      <footer className="public-footer">
        <div className="public-footer-grid">
          <div>
            <Brand appearance="dark" size="marketing" priority={false} />
            <p>{messages.footer.summary}</p>
          </div>
          <div>
            <strong>{messages.footer.product}</strong>
            <Link href={`${prefix}/how-it-works`}>{messages.nav.how}</Link>
            <Link href={`${prefix}/procurement-process`}>{messages.nav.process}</Link>
            <Link href={`${prefix}/solutions-by-role`}>{messages.nav.roles}</Link>
          </div>
          <div>
            <strong>{messages.footer.company}</strong>
            <Link href={`${prefix}/about`}>{messages.nav.about}</Link>
            <Link href={`${prefix}/contact`}>{messages.nav.contact}</Link>
          </div>
          <div>
            <strong>{messages.footer.legal}</strong>
            <Link href={`${prefix}/terms-and-conditions`}>{messages.footer.terms}</Link>
            <Link href={`${prefix}/privacy-policy`}>{messages.footer.privacy}</Link>
            <Link href={`${prefix}/security-and-privacy`}>{messages.nav.security}</Link>
          </div>
        </div>
        <div className="public-footer-bottom">
          <span>© {new Date().getFullYear()} Axora. {messages.footer.rights}</span>
          <span>axora.management</span>
        </div>
      </footer>
    </div>
  );
}

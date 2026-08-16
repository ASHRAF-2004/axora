import { Brand } from "@/components/Brand";
import { PasswordResetClient } from "@/components/PasswordResetClient";
import type { Metadata } from "next";
import Link from "next/link";
import { requestLocaleDecision } from "@/lib/locale-server";
import { LOCALE_NAMES } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function ResetPasswordPage() {
  const { locale } = await requestLocaleDecision();
  return (
    <main className="simple-auth-page" lang={locale} dir={LOCALE_NAMES[locale].dir}>
      <section className="simple-auth-wrap">
        <Link className="simple-auth-brand" href={`/${locale}`} aria-label="Axora"><Brand /></Link>
        <PasswordResetClient initialLocale={locale} />
      </section>
    </main>
  );
}

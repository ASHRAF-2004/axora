import { AxoraImmersiveExperience } from "@/components/public/AxoraImmersiveExperience";
import { VisitorChoiceChallenge } from "@/components/public/VisitorChoiceChallenge";
import type { Metadata } from "next";
import { isSupportedLocale, publicMessages, type SupportedLocale } from "@/lib/i18n";
import { notFound } from "next/navigation";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : "en";
  const messages = publicMessages(locale);
  return {
    title: messages.home.title,
    description: messages.home.lead,
    alternates: { canonical: `/${locale}`, languages: { en: "/en", ar: "/ar", ms: "/ms", "x-default": "/" } },
    openGraph: { title: messages.home.title, description: messages.home.lead, type: "website", url: `/${locale}`, siteName: "Axora" },
  };
}

export default async function PublicHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  if (!isSupportedLocale(rawLocale)) notFound();
  const locale = rawLocale as SupportedLocale;
  return (
    <AxoraImmersiveExperience
      locale={locale}
      route="home"
      challenge={<VisitorChoiceChallenge locale={locale} siteKey={process.env.TURNSTILE_SITE_KEY?.trim()} />}
    />
  );
}

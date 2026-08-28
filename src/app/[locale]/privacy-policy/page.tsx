import { LegalPage } from "@/components/public/LegalPage";
import { isSupportedLocale } from "@/lib/i18n";
import { legalPageContent } from "@/lib/legal-pages";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  const page = legalPageContent(locale, "privacy-policy");
  return { title: page.title, description: page.intro, alternates: { canonical: `/${locale}/privacy-policy`, languages: { en: "/en/privacy-policy", ar: "/ar/privacy-policy", ms: "/ms/privacy-policy", "x-default": "/en/privacy-policy" } } };
}

export default async function PrivacyPolicyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <LegalPage locale={locale} kind="privacy-policy" />;
}

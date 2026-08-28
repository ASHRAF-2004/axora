import { LegalPage } from "@/components/public/LegalPage";
import { isSupportedLocale } from "@/lib/i18n";
import { legalPageContent } from "@/lib/legal-pages";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};
  const page = legalPageContent(locale, "terms-and-conditions");
  return { title: page.title, description: page.intro, alternates: { canonical: `/${locale}/terms-and-conditions`, languages: { en: "/en/terms-and-conditions", ar: "/ar/terms-and-conditions", ms: "/ms/terms-and-conditions", "x-default": "/en/terms-and-conditions" } } };
}

export default async function TermsAndConditionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <LegalPage locale={locale} kind="terms-and-conditions" />;
}

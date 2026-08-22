import { isSupportedLocale } from "@/lib/i18n";
import { notFound, permanentRedirect } from "next/navigation";

export default async function RetiredLocalizedHelpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  permanentRedirect(`/${locale}/contact`);
}

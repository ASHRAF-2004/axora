import { notFound } from "next/navigation";
import { isSupportedLocale, LOCALE_NAMES, type SupportedLocale } from "@/lib/i18n";
import { requestLocaleDecision } from "@/lib/locale-server";
import { PublicShell } from "@/components/public/PublicShell";

export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "ar" }, { locale: "ms" }];
}

export default async function LocalizedPublicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  if (!isSupportedLocale(rawLocale)) notFound();
  const locale = rawLocale as SupportedLocale;
  const decision = await requestLocaleDecision();
  return (
    <div lang={locale} dir={LOCALE_NAMES[locale].dir}>
      <PublicShell
        locale={locale}
        detectedLocale={decision.locale}
        showLanguagePrompt={!decision.explicit}
      >
        {children}
      </PublicShell>
    </div>
  );
}

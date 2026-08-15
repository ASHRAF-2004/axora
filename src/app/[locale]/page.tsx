import { AxoraImmersiveExperience } from "@/components/public/AxoraImmersiveExperience";
import { VisitorChoiceChallenge } from "@/components/public/VisitorChoiceChallenge";
import type { Metadata } from "next";
import { isSupportedLocale, publicMessages, type SupportedLocale } from "@/lib/i18n";
import { getAccountLifecycleSession } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import {
  buildVisitorIdentity,
  getPublicVisitorSnapshot,
  VISITOR_CLAIM_COOKIE,
} from "@/lib/public-visitor-counter";
import { cookies, headers } from "next/headers";
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
  const [session, requestHeaders, cookieStore] = await Promise.all([
    getAccountLifecycleSession(),
    headers(),
    cookies(),
  ]);
  const privacyOptOut = requestHeaders.get("sec-gpc") === "1" || requestHeaders.get("dnt") === "1";
  let initialVisitorSnapshot;
  if (!session && !privacyOptOut) {
    if (isDemoMode()) {
      initialVisitorSnapshot = { version: 0, totalCount: 0, earlyBirdCount: 0, nightOwlCount: 0 };
    } else {
      try {
        initialVisitorSnapshot = await getPublicVisitorSnapshot(buildVisitorIdentity({
          cookieValue: cookieStore.get(VISITOR_CLAIM_COOKIE)?.value,
        }));
      } catch {
        initialVisitorSnapshot = undefined;
      }
    }
  }
  return (
    <AxoraImmersiveExperience
      locale={locale}
      route="home"
      challenge={!session && !privacyOptOut ? <VisitorChoiceChallenge
        locale={locale}
        siteKey={process.env.TURNSTILE_SITE_KEY?.trim()}
        initialSnapshot={initialVisitorSnapshot}
      /> : null}
    />
  );
}

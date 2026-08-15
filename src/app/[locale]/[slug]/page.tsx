import { AxoraImmersiveExperience } from "@/components/public/AxoraImmersiveExperience";
import type { PublicSceneRoute } from "@/lib/immersive-public-experience";
import type { Metadata } from "next";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isSupportedLocale, PUBLIC_PAGE_SLUGS, publicMessages, type PublicPageSlug, type SupportedLocale } from "@/lib/i18n";

const immersiveRoutes = new Set<PublicSceneRoute>([
  "how-it-works",
  "procurement-process",
  "solutions-by-role",
  "security-and-privacy",
  "about",
]);

function isPublicSlug(value: string): value is PublicPageSlug {
  return (PUBLIC_PAGE_SLUGS as readonly string[]).includes(value);
}

export function generateStaticParams() {
  return PUBLIC_PAGE_SLUGS.flatMap((slug) => ["en", "ar", "ms"].map((locale) => ({ locale, slug })));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  if (!isSupportedLocale(rawLocale) || !isPublicSlug(slug)) return {};
  const page = publicMessages(rawLocale).pages[slug];
  return {
    title: page.title,
    description: page.intro,
    alternates: { canonical: `/${rawLocale}/${slug}`, languages: { en: `/en/${slug}`, ar: `/ar/${slug}`, ms: `/ms/${slug}`, "x-default": `/en/${slug}` } },
    openGraph: { title: page.title, description: page.intro, type: "website", url: `/${rawLocale}/${slug}`, siteName: "Axora" },
  };
}

export default async function PublicContentPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: rawLocale, slug } = await params;
  if (!isSupportedLocale(rawLocale) || !isPublicSlug(slug)) notFound();
  const locale = rawLocale as SupportedLocale;
  if (immersiveRoutes.has(slug as PublicSceneRoute)) {
    return <AxoraImmersiveExperience locale={locale} route={slug as PublicSceneRoute} />;
  }
  const messages = publicMessages(locale);
  const page = messages.pages[slug];
  return <>
    <section className="public-page-hero">
      <p className="public-eyebrow">{page.eyebrow}</p>
      <h1>{page.title}</h1>
      <p>{page.intro}</p>
    </section>
    <section className="public-content-sections">
      {page.sections.map((section, index) => <article key={section.title}>
        <span>{String(index + 1).padStart(2, "0")}</span>
        <div>
          <h2>{section.title}</h2><p>{section.body}</p>
          {section.points?.length ? <ul>{section.points.map((point) => <li key={point}><CheckCircle2 size={16} aria-hidden="true" />{point}</li>)}</ul> : null}
        </div>
      </article>)}
    </section>
    <section className="public-inline-cta">
      <div><strong>{messages.home.closingTitle}</strong><p>{messages.home.closingBody}</p></div>
      <Link className="button button-primary" href={`/${locale}/contact`}>{messages.nav.contact}<ArrowRight className="public-directional-icon" size={17} aria-hidden="true" /></Link>
    </section>
  </>;
}

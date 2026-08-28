import { legalPageContent, type LegalPageKind } from "@/lib/legal-pages";
import type { SupportedLocale } from "@/lib/i18n";

export function LegalPage({ locale, kind }: { locale: SupportedLocale; kind: LegalPageKind }) {
  const page = legalPageContent(locale, kind);
  return <>
    <section className="public-page-hero public-legal-hero">
      <p className="public-eyebrow">{page.eyebrow}</p>
      <h1>{page.title}</h1>
      <p>{page.intro}</p>
      <dl className="public-legal-version">
        <div><dt>{page.effectiveLabel}</dt><dd>{page.effectiveDate}</dd></div>
        <div><dt>{page.versionLabel}</dt><dd>{page.version}</dd></div>
      </dl>
    </section>
    <section className="public-legal-sections">
      {page.sections.map((section) => <article key={section.title}>
        <h2>{section.title}</h2>
        <p>{section.body}</p>
        {section.points?.length ? <ul>{section.points.map((point) => <li key={point}>{point}</li>)}</ul> : null}
      </article>)}
      <article className="public-legal-contact">
        <h2>{page.contactTitle}</h2>
        <p>{page.contactBody}</p>
        <a href="mailto:support@axora.management"><bdi dir="ltr">support@axora.management</bdi></a>
      </article>
    </section>
  </>;
}

import { ContactSubmitButton } from "@/components/public/ContactSubmitButton";
import { isSupportedLocale, publicMessages, type SupportedLocale } from "@/lib/i18n";
import { CheckCircle2, CircleAlert, LockKeyhole, MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Script from "next/script";
import { notFound } from "next/navigation";
import { submitContactAction } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  if (!isSupportedLocale(rawLocale)) return {};
  const content = publicMessages(rawLocale).contact;
  return {
    title: content.title,
    description: content.intro,
    alternates: {
      canonical: `/${rawLocale}/contact`,
      languages: { en: "/en/contact", ar: "/ar/contact", ms: "/ms/contact", "x-default": "/en/contact" },
    },
    openGraph: { title: content.title, description: content.intro, type: "website", url: `/${rawLocale}/contact`, siteName: "Axora" },
  };
}

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: rawLocale } = await params;
  if (!isSupportedLocale(rawLocale)) notFound();
  const locale = rawLocale as SupportedLocale;
  const messages = publicMessages(locale);
  const search = await searchParams;
  const status = typeof search.status === "string" ? search.status : undefined;
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim() ?? "";
  const available = /^[A-Za-z0-9_-]{10,100}$/.test(siteKey);
  return <>
    <section className="public-page-hero public-contact-hero">
      <p className="public-eyebrow">{messages.contact.eyebrow}</p>
      <h1>{messages.contact.title}</h1>
      <p>{messages.contact.intro}</p>
    </section>
    <section className="public-contact-layout">
      <div className="public-contact-context">
        <span><MailCheck size={23} /></span><h2>{messages.nav.contact}</h2>
        <p>{messages.home.closingBody}</p>
        <div><LockKeyhole size={18} /><p>{messages.contact.securityNote}</p></div>
      </div>
      <form action={submitContactAction.bind(null, locale)} className="public-contact-form" aria-label={messages.contact.title}>
        {status === "success" ? <div className="form-success" role="status"><CheckCircle2 size={18} />{messages.contact.success}</div> : null}
        {status === "failure" ? <div className="form-alert" role="alert"><CircleAlert size={18} />{messages.contact.failure}</div> : null}
        <div className="form-grid">
          <label>{messages.contact.name}<input name="name" autoComplete="name" minLength={2} maxLength={200} required /></label>
          <label>{messages.contact.email}<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
          <label>{messages.contact.company}<input name="company" autoComplete="organization" maxLength={200} required /></label>
          <label>{messages.contact.phone}<input name="phone" type="tel" autoComplete="tel" maxLength={40} /></label>
          <label className="field-full">{messages.contact.subject}<input name="subject" minLength={3} maxLength={200} required /></label>
          <label className="field-full">{messages.contact.message}<textarea name="message" rows={7} minLength={10} maxLength={5000} required /></label>
        </div>
        <label className="contact-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
        <label className="public-contact-consent"><input name="privacyAccepted" type="checkbox" required /><span>{messages.contact.privacy}</span></label>
        {available ? <div className="cf-turnstile" data-sitekey={siteKey} data-action="contact" data-theme="light" data-language={locale} /> : <div className="form-alert" role="status">{messages.contact.unavailable}</div>}
        <div className="public-contact-submit"><span>{messages.contact.validationNote}</span><ContactSubmitButton submit={messages.contact.submit} sending={messages.contact.sending} unavailable={!available} /></div>
      </form>
    </section>
    {available ? <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" /> : null}
  </>;
}

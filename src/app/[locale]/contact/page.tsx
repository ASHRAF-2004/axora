import { ContactSubmitButton } from "@/components/public/ContactSubmitButton";
import { isSupportedLocale, publicMessages, type SupportedLocale } from "@/lib/i18n";
import { randomUUID } from "node:crypto";
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
  const campaignValue = (key: string) => {
    const value = search[key];
    return (typeof value === "string" ? value : "").slice(0, 200);
  };
  const formCopy = locale === "ar"
    ? { intro: "أرسل استفسارك إلى فريق Axora", company: "اسم الشركة", name: "اسمك", subject: "الموضوع", message: "الرسالة" }
    : locale === "ms"
      ? { intro: "Hantar pertanyaan anda kepada pasukan Axora", company: "Nama syarikat", name: "Nama anda", subject: "Subjek", message: "Mesej" }
      : { intro: "Send your enquiry to the Axora team", company: "Company name", name: "Your name", subject: "Subject", message: "Message" };
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
          <div className="field-full"><h2>{formCopy.intro}</h2></div>
          <label>{formCopy.company}<input name="companyName" autoComplete="organization" minLength={2} maxLength={200} required /></label>
          <label>{formCopy.name}<input name="contactName" autoComplete="name" minLength={2} maxLength={200} required /></label>
          <label className="field-full">{formCopy.subject}<input name="subject" minLength={3} maxLength={200} required /></label>
          <label className="field-full">{formCopy.message}<textarea name="message" rows={7} minLength={10} maxLength={5000} required /></label>
        </div>
        <input type="hidden" name="idempotencyToken" value={randomUUID()} />
        <input type="hidden" name="utmSource" value={campaignValue("utm_source")} />
        <input type="hidden" name="utmMedium" value={campaignValue("utm_medium")} />
        <input type="hidden" name="utmCampaign" value={campaignValue("utm_campaign")} />
        <input type="hidden" name="utmTerm" value={campaignValue("utm_term")} />
        <input type="hidden" name="utmContent" value={campaignValue("utm_content")} />
        <label className="contact-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
        <label className="public-contact-consent"><input name="privacyAccepted" type="checkbox" required /><span>{messages.contact.privacy}</span></label>
        {available ? <div className="cf-turnstile" data-sitekey={siteKey} data-action="contact" data-theme="light" data-language={locale} /> : <div className="form-alert" role="status">{messages.contact.unavailable}</div>}
        <div className="public-contact-submit"><span>{messages.contact.validationNote}</span><ContactSubmitButton submit={messages.contact.submit} sending={messages.contact.sending} unavailable={!available} /></div>
      </form>
    </section>
    {available ? <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" /> : null}
  </>;
}

import { ContactVerificationControls } from "@/components/public/ContactVerificationControls";
import { InternationalPhoneInput } from "@/components/InternationalPhoneInput";
import { isSupportedLocale, publicMessages, type SupportedLocale } from "@/lib/i18n";
import { randomUUID } from "node:crypto";
import { CheckCircle2, CircleAlert, Mail, MapPin, MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
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
  const contactCopy = locale === "ar"
    ? { home: "الرئيسية", details: "معلومات التواصل", email: "البريد الإلكتروني", phone: "واتساب / اتصال", person: "السيد أشرف", address: "العنوان", privacyLink: "سياسة الخصوصية" }
    : locale === "ms"
      ? { home: "Laman utama", details: "Maklumat hubungan", email: "E-mel", phone: "WhatsApp / Panggilan", person: "Encik Ashraf", address: "Alamat", privacyLink: "Dasar Privasi" }
      : { home: "Home", details: "Contact information", email: "Email", phone: "WhatsApp / Call", person: "Mr. Ashraf", address: "Address", privacyLink: "Privacy Policy" };
  return <>
    <section className="public-page-hero public-contact-hero">
      <nav className="public-breadcrumb" aria-label={locale === "ar" ? "مسار التنقل" : "Breadcrumb"}>
        <Link href={`/${locale}`}>{contactCopy.home}</Link><span aria-hidden="true">/</span><span>{messages.nav.contact}</span>
      </nav>
      <p className="public-eyebrow">{messages.contact.eyebrow}</p>
      <h1>{messages.contact.title}</h1>
      <p>{messages.contact.intro}</p>
    </section>
    <section className="public-contact-layout">
      <form action={submitContactAction.bind(null, locale)} className="public-contact-form" aria-label={messages.contact.title}>
        {status === "success" ? <div className="form-success" role="status"><CheckCircle2 size={18} />{messages.contact.success}</div> : null}
        {status === "failure" ? <div className="form-alert" role="alert"><CircleAlert size={18} />{messages.contact.failure}</div> : null}
        <div className="form-grid">
          <label>{messages.contact.name}<input name="fullName" autoComplete="name" minLength={2} maxLength={200} required /></label>
          <label>{messages.contact.email}<input name="email" type="email" inputMode="email" autoComplete="email" maxLength={254} required /></label>
          <div className="field-full"><InternationalPhoneInput label={messages.contact.phone} locale={locale} name="phone" required /></div>
          <label className="field-full">{messages.contact.message}<textarea name="message" rows={7} minLength={10} maxLength={5000} required /></label>
        </div>
        <input type="hidden" name="idempotencyToken" value={randomUUID()} />
        <input type="hidden" name="utmSource" value={campaignValue("utm_source")} />
        <input type="hidden" name="utmMedium" value={campaignValue("utm_medium")} />
        <input type="hidden" name="utmCampaign" value={campaignValue("utm_campaign")} />
        <input type="hidden" name="utmTerm" value={campaignValue("utm_term")} />
        <input type="hidden" name="utmContent" value={campaignValue("utm_content")} />
        <label className="contact-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
        <label className="public-contact-consent"><input name="privacyAccepted" type="checkbox" required /><span>{messages.contact.privacy} <Link href={`/${locale}/privacy-policy`}>{contactCopy.privacyLink}</Link>.</span></label>
        {available ? <ContactVerificationControls locale={locale} siteKey={siteKey} submit={messages.contact.submit} sending={messages.contact.sending} validationNote={messages.contact.validationNote} unavailableMessage={messages.contact.unavailable} /> : <div className="form-alert" role="status">{messages.contact.unavailable}</div>}
      </form>
      <aside className="public-contact-card" aria-labelledby="contact-information-title">
        <h2 id="contact-information-title">{contactCopy.details}</h2>
        <div className="public-contact-detail"><Mail size={21} aria-hidden="true" /><div><strong>{contactCopy.email}</strong><a href="mailto:support@axora.management"><bdi dir="ltr">support@axora.management</bdi></a></div></div>
        <div className="public-contact-detail"><MessageCircle size={21} aria-hidden="true" /><div><strong>{contactCopy.phone}</strong><span>{contactCopy.person}</span><div className="public-contact-actions"><a href="tel:+60183816023"><bdi dir="ltr">+60183816023</bdi></a><a href="https://wa.me/60183816023" rel="noreferrer">WhatsApp</a></div></div></div>
        <div className="public-contact-detail"><MapPin size={21} aria-hidden="true" /><div><strong>{contactCopy.address}</strong><address>06-A02, Kenwingston Business Centre,<br />Persiaran Bestari, Cyber 9<br />63000 Cyberjaya, Selangor</address></div></div>
      </aside>
    </section>
  </>;
}

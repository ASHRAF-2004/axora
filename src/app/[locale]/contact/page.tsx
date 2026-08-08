import { ContactSubmitButton } from "@/components/public/ContactSubmitButton";
import { companyLeadMessages } from "@/lib/company-leads-i18n";
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
  const lead = companyLeadMessages(locale);
  const search = await searchParams;
  const status = typeof search.status === "string" ? search.status : undefined;
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim() ?? "";
  const available = /^[A-Za-z0-9_-]{10,100}$/.test(siteKey);
  const campaignValue = (key: string) => {
    const value = search[key];
    return (typeof value === "string" ? value : "").slice(0, 200);
  };
  const employeeOptions = [
    ["1_10", "1-10"], ["11_50", "11-50"], ["51_200", "51-200"],
    ["201_500", "201-500"], ["501_1000", "501-1,000"], ["1001_PLUS", "1,001+"],
  ];
  const branchOptions = [["1", "1"], ["2_5", "2-5"], ["6_20", "6-20"], ["21_50", "21-50"], ["51_PLUS", "51+"]];
  const spendOptions = [
    ["UNDER_10K", "< MYR 10k"], ["10K_50K", "MYR 10k-50k"],
    ["50K_250K", "MYR 50k-250k"], ["250K_1M", "MYR 250k-1m"],
    ["OVER_1M", "> MYR 1m"], ["UNDISCLOSED", locale === "ar" ? "أفضل عدم الإفصاح" : locale === "ms" ? "Tidak didedahkan" : "Prefer not to disclose"],
  ];
  const contactMethods = [
    ["EMAIL", locale === "ar" ? "البريد الإلكتروني" : locale === "ms" ? "E-mel" : "Email"],
    ["PHONE", locale === "ar" ? "الهاتف" : locale === "ms" ? "Telefon" : "Phone"],
    ["WHATSAPP", "WhatsApp"], ["VIDEO_CALL", locale === "ar" ? "مكالمة فيديو" : locale === "ms" ? "Panggilan video" : "Video call"],
  ];
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
          <div className="field-full"><h2>{lead.publicTitle}</h2><p>{lead.publicIntro}</p></div>
          <label>{lead.legalName}<input name="companyLegalName" autoComplete="organization" minLength={2} maxLength={300} required /></label>
          <label>{lead.displayName}<input name="companyName" autoComplete="organization" minLength={2} maxLength={200} required /></label>
          <label>{lead.registrationNumber}<input name="registrationNumber" maxLength={160} /></label>
          <label>{lead.industry}<input name="industry" minLength={2} maxLength={200} required /></label>
          <label>{lead.contactName}<input name="contactName" autoComplete="name" minLength={2} maxLength={200} required /></label>
          <label>{lead.businessEmail}<input name="contactEmail" type="email" inputMode="email" dir="ltr" autoComplete="email" maxLength={254} required /></label>
          <label>{lead.countryCode}<input name="phoneCountryCode" type="tel" dir="ltr" defaultValue="+60" pattern="\\+[0-9]{1,4}" maxLength={12} required /></label>
          <label>{lead.phone}<input name="phone" type="tel" dir="ltr" autoComplete="tel-national" minLength={3} maxLength={40} required /></label>
          <label>{lead.country}<input name="country" autoComplete="country-name" minLength={2} maxLength={120} required /></label>
          <label>{lead.region}<input name="region" autoComplete="address-level1" minLength={2} maxLength={160} required /></label>
          <label>{lead.city}<input name="city" autoComplete="address-level2" minLength={2} maxLength={160} required /></label>
          <label>{lead.employees}<select name="employeeRange" required defaultValue=""><option value="" disabled>-</option>{employeeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>{lead.branches}<select name="branchRange" required defaultValue=""><option value="" disabled>-</option>{branchOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>{lead.spend}<select name="spendRange" required defaultValue=""><option value="" disabled>-</option>{spendOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>{lead.contactMethod}<select name="contactMethod" required defaultValue="EMAIL">{contactMethods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>{lead.contactTime}<input name="contactTime" maxLength={160} placeholder={locale === "ar" ? "مثال: أيام العمل صباحًا" : locale === "ms" ? "Contoh: pagi hari bekerja" : "Example: weekday mornings"} /></label>
          <label>{lead.timezone}<input name="contactTimezone" dir="ltr" defaultValue="Asia/Kuala_Lumpur" minLength={1} maxLength={80} required /></label>
          <label className="field-full">{lead.subject}<input name="subject" minLength={3} maxLength={200} required /></label>
          <label className="field-full">{lead.message}<textarea name="message" rows={7} minLength={10} maxLength={5000} required /></label>
          <p className="field-full">{lead.attachmentPolicy}</p>
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

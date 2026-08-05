import { VisitorChoiceChallenge } from "@/components/public/VisitorChoiceChallenge";
import type { Metadata } from "next";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  PackageCheck,
  ReceiptText,
  ScanLine,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { isSupportedLocale, publicMessages, type SupportedLocale } from "@/lib/i18n";
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

const stageIcons = [FileSearch, ClipboardCheck, BadgeCheck, Users, PackageCheck, Truck, ScanLine, ReceiptText, CheckCircle2];

export default async function PublicHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  if (!isSupportedLocale(rawLocale)) notFound();
  const locale = rawLocale as SupportedLocale;
  const messages = publicMessages(locale);
  const prefix = `/${locale}`;
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY?.trim();
  return (
    <>
      <section className="public-hero">
        <div className="public-hero-copy">
          <p className="public-eyebrow">{messages.home.eyebrow}</p>
          <h1>{messages.home.title}</h1>
          <p className="public-lead">{messages.home.lead}</p>
          <div className="public-hero-actions">
            <Link className="button button-primary" href={`${prefix}/how-it-works`}>
              {messages.home.primaryAction}<ArrowRight className="public-directional-icon" size={18} aria-hidden="true" />
            </Link>
            <Link className="button button-secondary" href={`${prefix}/contact`}>{messages.home.secondaryAction}</Link>
          </div>
          <p className="public-trust-note"><ShieldCheck size={18} aria-hidden="true" />{messages.home.trustNote}</p>
        </div>
        <div className="public-hero-visual" aria-label={messages.home.heroVisualLabel}>
          <div className="hero-workflow-card hero-card-request">
            <span>01</span><ClipboardCheck aria-hidden="true" /><strong>{messages.home.requestLabel}</strong><small>{messages.home.requestBody}</small>
          </div>
          <div className="hero-workflow-line" aria-hidden="true" />
          <div className="hero-workflow-card hero-card-approve">
            <span>02</span><BadgeCheck aria-hidden="true" /><strong>{messages.home.approveLabel}</strong><small>{messages.home.approveBody}</small>
          </div>
          <div className="hero-workflow-card hero-card-deliver">
            <span>03</span><Truck aria-hidden="true" /><strong>{messages.home.deliverLabel}</strong><small>{messages.home.deliverBody}</small>
          </div>
          <div className="hero-proof-chip"><CheckCircle2 size={17} aria-hidden="true" /> {messages.home.traceableLabel}</div>
        </div>
      </section>

      <VisitorChoiceChallenge
        locale={locale}
        siteKey={turnstileSiteKey}
      />

      <section className="public-section public-process-section">
        <div className="public-section-heading">
          <p className="public-eyebrow">{messages.home.processEyebrow}</p>
          <h2>{messages.home.processTitle}</h2>
          <p>{messages.home.processLead}</p>
        </div>
        <ol className="public-process-grid">
          {messages.home.stages.map((stage, index) => {
            const Icon = stageIcons[index];
            return (
              <li key={stage.title}>
                <div><Icon size={20} aria-hidden="true" /><span>{String(index + 1).padStart(2, "0")}</span></div>
                <h3>{stage.title}</h3><p>{stage.body}</p>
              </li>
            );
          })}
        </ol>
        <Link className="public-text-link" href={`${prefix}/procurement-process`}>
          {messages.nav.process}<ArrowRight className="public-directional-icon" size={17} aria-hidden="true" />
        </Link>
      </section>

      <section className="public-section public-role-section">
        <div className="public-section-heading">
          <p className="public-eyebrow">{messages.home.rolesEyebrow}</p>
          <h2>{messages.home.rolesTitle}</h2>
          <p>{messages.home.rolesLead}</p>
        </div>
        <div className="public-role-grid">
          {messages.home.roles.map((role, index) => {
            const Icon = [Building2, Users, Truck][index];
            return (
              <Link href={`${prefix}/${role.href}`} key={role.title}>
                <Icon size={25} aria-hidden="true" />
                <h3>{role.title}</h3><p>{role.body}</p><span>{messages.nav.how}<ArrowRight className="public-directional-icon" size={16} aria-hidden="true" /></span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="public-section public-split-feature">
        <div>
          <p className="public-eyebrow">{messages.home.trackingEyebrow}</p>
          <h2>{messages.home.trackingTitle}</h2>
          <p>{messages.home.trackingBody}</p>
          <div className="public-mini-timeline" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        </div>
        <div>
          <p className="public-eyebrow">{messages.home.securityEyebrow}</p>
          <h2>{messages.home.securityTitle}</h2>
          <p>{messages.home.securityBody}</p>
          <Link className="public-text-link" href={`${prefix}/security-and-privacy`}>
            {messages.nav.security}<ArrowRight className="public-directional-icon" size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="public-cta">
        <div><p className="public-eyebrow">{messages.home.contactEyebrow}</p><h2>{messages.home.closingTitle}</h2><p>{messages.home.closingBody}</p></div>
        <Link className="button button-primary" href={`${prefix}/contact`}>{messages.nav.contact}<ArrowRight className="public-directional-icon" size={18} aria-hidden="true" /></Link>
      </section>
    </>
  );
}

import { VisitorChoiceChallenge } from "@/components/public/VisitorChoiceChallenge";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  FileText,
  MapPin,
  PackageCheck,
  ShieldCheck,
  Truck,
} from "lucide-react";
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

const stageIcons = [
  ClipboardList,
  BadgeCheck,
  CreditCard,
  FileText,
  PackageCheck,
  Truck,
  MapPin,
  CheckCircle2,
] as const;

export default async function PublicHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  if (!isSupportedLocale(rawLocale)) notFound();
  const locale = rawLocale as SupportedLocale;
  const messages = publicMessages(locale);
  const prefix = `/${locale}`;
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
    <>
      {!session && !privacyOptOut ? (
        <VisitorChoiceChallenge
          locale={locale}
          siteKey={process.env.TURNSTILE_SITE_KEY?.trim()}
          initialSnapshot={initialVisitorSnapshot}
        />
      ) : null}

      <section className="public-hero simple-public-hero" aria-labelledby="public-home-title">
        <div className="public-hero-copy">
          <p className="eyebrow">{messages.home.eyebrow}</p>
          <h1 id="public-home-title">{messages.home.title}</h1>
          <p className="public-hero-lead">{messages.home.lead}</p>
          <div className="public-hero-actions">
            <Link className="button button-primary" href={`${prefix}/how-it-works`}>
              {messages.home.primaryAction}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link className="button button-secondary" href={`${prefix}/contact`}>
              {messages.home.secondaryAction}
            </Link>
          </div>
          <p className="public-trust-note"><ShieldCheck size={18} aria-hidden="true" />{messages.home.trustNote}</p>
        </div>

        <div className="simple-lifecycle-card" aria-label={messages.home.heroVisualLabel}>
          <div className="simple-lifecycle-header">
            <span>{messages.home.heroVisualLabel}</span>
            <span className="status-badge status-success">{messages.home.traceableLabel}</span>
          </div>
          <ol className="simple-lifecycle-list">
            <li><ClipboardList aria-hidden="true" /><span><strong>{messages.home.requestLabel}</strong><small>{messages.home.requestBody}</small></span></li>
            <li><BadgeCheck aria-hidden="true" /><span><strong>{messages.home.approveLabel}</strong><small>{messages.home.approveBody}</small></span></li>
            <li><Truck aria-hidden="true" /><span><strong>{messages.home.deliverLabel}</strong><small>{messages.home.deliverBody}</small></span></li>
          </ol>
          <div className="simple-lifecycle-foot"><CheckCircle2 size={20} aria-hidden="true" />{messages.home.traceableLabel}</div>
        </div>
      </section>

      <section className="public-section public-process-section" aria-labelledby="public-process-title">
        <div className="public-section-heading">
          <p className="eyebrow">{messages.home.processEyebrow}</p>
          <h2 id="public-process-title">{messages.home.processTitle}</h2>
          <p>{messages.home.processLead}</p>
        </div>
        <ol className="public-process-grid simple-process-grid">
          {messages.home.stages.map((stage, index) => {
            const Icon = stageIcons[index] ?? CheckCircle2;
            return (
              <li key={stage.title}>
                <div><Icon size={22} aria-hidden="true" /><span>{String(index + 1).padStart(2, "0")}</span></div>
                <h3>{stage.title}</h3>
                <p>{stage.body}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="public-section public-role-section" aria-labelledby="public-roles-title">
        <div className="public-section-heading">
          <p className="eyebrow">{messages.home.rolesEyebrow}</p>
          <h2 id="public-roles-title">{messages.home.rolesTitle}</h2>
          <p>{messages.home.rolesLead}</p>
        </div>
        <div className="public-role-grid simple-role-grid">
          {messages.home.roles.map((role, index) => (
            <Link href={`${prefix}/${role.href}`} key={role.title}>
              {index === 0 ? <Building2 size={28} aria-hidden="true" /> : <Truck size={28} aria-hidden="true" />}
              <h3>{role.title}</h3>
              <p>{role.body}</p>
              <span>{messages.nav.how}<ArrowRight size={15} aria-hidden="true" /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="public-section simple-assurance-grid">
        <article>
          <MapPin size={28} aria-hidden="true" />
          <p className="eyebrow">{messages.home.trackingEyebrow}</p>
          <h2>{messages.home.trackingTitle}</h2>
          <p>{messages.home.trackingBody}</p>
        </article>
        <article>
          <ShieldCheck size={28} aria-hidden="true" />
          <p className="eyebrow">{messages.home.securityEyebrow}</p>
          <h2>{messages.home.securityTitle}</h2>
          <p>{messages.home.securityBody}</p>
        </article>
      </section>

      <section className="public-section simple-public-cta" aria-labelledby="public-contact-title">
        <div>
          <p className="eyebrow">{messages.home.contactEyebrow}</p>
          <h2 id="public-contact-title">{messages.home.closingTitle}</h2>
          <p>{messages.home.closingBody}</p>
        </div>
        <Link className="button button-primary" href={`${prefix}/contact`}>
          {messages.home.secondaryAction}<ArrowRight size={17} aria-hidden="true" />
        </Link>
      </section>
    </>
  );
}

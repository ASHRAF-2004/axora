import { getSession } from "@/lib/auth";
import { externalApiEnabled } from "@/lib/integrations/config";
import { prepareAuthorization } from "@/lib/integrations/oauth";
import type { IntegrationScope } from "@/lib/integrations/scopes";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import styles from "./OAuthConsent.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Authorize integration",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

const copy = {
  en: {
    eyebrow: "Secure connection",
    title: (app: string) => `Connect ${app}`,
    description: (app: string, company: string) => `${app} is requesting limited access to ${company}.`,
    permissions: "Requested permissions",
    boundary: "This app receives only the permissions below. Axora still checks your live role, company scope, and explicit access rules on every API request.",
    approve: "Allow connection",
    deny: "Cancel",
    footnote: "You can disconnect this app from Integrations. Your Axora password is never shared.",
    invalidTitle: "This authorization request is unavailable",
    invalidBody: "The request may be invalid, expired, or outside your current company authority.",
    back: "Back to Integrations",
    scopes: {
      "companies:read": "Read the connected company's safe profile",
      "requests:read": "Read purchase requests in your current scope",
      "requests:draft": "Create review-required request drafts",
      "deliveries:read": "Read safe delivery status",
      "invoices:read": "Read customer invoices",
      "webhooks:manage": "Manage company webhook subscriptions",
    },
  },
  ar: {
    eyebrow: "اتصال آمن",
    title: (app: string) => `ربط ${app}`,
    description: (app: string, company: string) => `يطلب ${app} وصولًا محدودًا إلى ${company}.`,
    permissions: "الصلاحيات المطلوبة",
    boundary: "يحصل هذا التطبيق على الصلاحيات الموضحة أدناه فقط. تتحقق أكسورا من دورك الحالي ونطاق الشركة وقواعد المنع الصريحة عند كل طلب API.",
    approve: "السماح بالاتصال",
    deny: "إلغاء",
    footnote: "يمكنك فصل التطبيق من صفحة التكاملات. لا تتم مشاركة كلمة مرور أكسورا مطلقًا.",
    invalidTitle: "طلب التفويض غير متاح",
    invalidBody: "قد يكون الطلب غير صالح أو منتهيًا أو خارج صلاحياتك الحالية للشركة.",
    back: "العودة إلى التكاملات",
    scopes: {
      "companies:read": "قراءة الملف الآمن للشركة المتصلة",
      "requests:read": "قراءة طلبات الشراء ضمن نطاقك الحالي",
      "requests:draft": "إنشاء مسودات طلبات تتطلب المراجعة",
      "deliveries:read": "قراءة حالة التسليم الآمنة",
      "invoices:read": "قراءة فواتير العملاء",
      "webhooks:manage": "إدارة اشتراكات Webhook للشركة",
    },
  },
  ms: {
    eyebrow: "Sambungan selamat",
    title: (app: string) => `Sambungkan ${app}`,
    description: (app: string, company: string) => `${app} meminta akses terhad kepada ${company}.`,
    permissions: "Kebenaran diminta",
    boundary: "Aplikasi ini hanya menerima kebenaran di bawah. Axora masih menyemak peranan langsung, skop syarikat dan peraturan penafian nyata anda pada setiap permintaan API.",
    approve: "Benarkan sambungan",
    deny: "Batal",
    footnote: "Anda boleh memutuskan aplikasi ini dari Integrasi. Kata laluan Axora anda tidak pernah dikongsi.",
    invalidTitle: "Permintaan kebenaran ini tidak tersedia",
    invalidBody: "Permintaan mungkin tidak sah, tamat tempoh atau di luar kuasa syarikat semasa anda.",
    back: "Kembali ke Integrasi",
    scopes: {
      "companies:read": "Baca profil selamat syarikat yang disambungkan",
      "requests:read": "Baca permintaan pembelian dalam skop semasa anda",
      "requests:draft": "Cipta draf permintaan yang memerlukan semakan",
      "deliveries:read": "Baca status penghantaran yang selamat",
      "invoices:read": "Baca invois pelanggan",
      "webhooks:manage": "Urus langganan webhook syarikat",
    },
  },
} as const;

function strictParameters(values: Record<string, string | string[] | undefined>) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) return null;
    if (value !== undefined) parameters.set(key, value);
  }
  return parameters;
}

function ErrorCard({ locale }: { locale: keyof typeof copy }) {
  const text = copy[locale];
  return <main className={styles.page} lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
    <section className={styles.card} aria-labelledby="oauth-error-title">
      <div className={styles.mark}><ShieldCheck aria-hidden="true" size={26} /></div>
      <p className={styles.eyebrow}>{text.eyebrow}</p>
      <h1 id="oauth-error-title">{text.invalidTitle}</h1>
      <p className={styles.description}>{text.invalidBody}</p>
      <Link className={styles.secondaryLink} href="/integrations">{text.back}</Link>
    </section>
  </main>;
}

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!externalApiEnabled()) notFound();
  const values = await searchParams;
  const parameters = strictParameters(values);
  const currentPath = parameters ? `/oauth/authorize?${parameters.toString()}` : "/oauth/authorize";
  const actor = await getSession();
  if (!actor) {
    const login = new URLSearchParams({ reason: "required", returnTo: currentPath });
    redirect(`/login?${login.toString()}`);
  }
  const locale = actor.preferredLocale ?? "en";
  if (!parameters) return <ErrorCard locale={locale} />;
  let prepared: Awaited<ReturnType<typeof prepareAuthorization>>;
  try {
    prepared = await prepareAuthorization({
      actor,
      parameters,
      requestId: crypto.randomUUID(),
    });
  } catch {
    return <ErrorCard locale={locale} />;
  }
  if (!prepared.ok) return <ErrorCard locale={locale} />;
  const text = copy[locale];
  const authorization = prepared.authorization;
  return <main className={styles.page} lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
    <section className={styles.card} aria-labelledby="oauth-consent-title">
      <div className={styles.mark}><ShieldCheck aria-hidden="true" size={26} /></div>
      <p className={styles.eyebrow}>{text.eyebrow}</p>
      <h1 id="oauth-consent-title">{text.title(authorization.application.name)}</h1>
      <p className={styles.description}>
        {text.description(authorization.application.name, authorization.companyName)}
      </p>
      <div className={styles.permissionPanel}>
        <h2>{text.permissions}</h2>
        <ul>
          {authorization.scopes.map((scope: IntegrationScope) => <li key={scope}>
            <ShieldCheck aria-hidden="true" size={18} />
            <span>{text.scopes[scope]}</span>
          </li>)}
        </ul>
      </div>
      <p className={styles.boundary}>{text.boundary}</p>
      <form action="/oauth/authorize/decision" method="post" className={styles.actions}>
        <input type="hidden" name="handle" value={authorization.handle} />
        <button className={styles.primaryButton} type="submit" name="decision" value="approve">
          {text.approve}
        </button>
        <button className={styles.secondaryButton} type="submit" name="decision" value="deny">
          {text.deny}
        </button>
      </form>
      <p className={styles.footnote}>{text.footnote}</p>
    </section>
  </main>;
}

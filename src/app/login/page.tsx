import { Brand } from "@/components/Brand";
import { LoginForm } from "@/components/LoginForm";
import { getAccountLifecycleSession } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import { ArrowLeft, Boxes, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { landingPathForSession } from "@/lib/session-landing";
import { requestLocaleDecision } from "@/lib/locale-server";
import { getMyProfile, myProfileMeetsRequiredOnboarding } from "@/lib/profile";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false, noarchive: true } };

const pageCopy = {
  en: { chip: "Multi-company operations", title: "One clear place for every request.", body: "Request catalog items, approve branch spending, and follow Axora fulfilment from delivery through customer invoice.", points: ["Clear requester and approver roles", "Monthly budgets for every branch", "Secure, isolated company workspaces"], footer: "Axora operations · Secure procurement management", back: "Axora website" },
  ar: { chip: "عمليات متعددة الشركات", title: "مكان واضح لكل طلب.", body: "اطلب منتجات الكتالوج واعتمد إنفاق الفروع وتابع تنفيذ Axora من التسليم حتى فاتورة العميل.", points: ["أدوار واضحة لمقدمي الطلبات والمعتمدين", "ميزانيات شهرية لكل فرع", "مساحات شركات آمنة ومعزولة"], footer: "عمليات Axora · إدارة مشتريات آمنة", back: "موقع Axora" },
  ms: { chip: "Operasi berbilang syarikat", title: "Satu tempat yang jelas untuk setiap permintaan.", body: "Minta item katalog, luluskan perbelanjaan cawangan dan ikuti pemenuhan Axora daripada penghantaran hingga invois pelanggan.", points: ["Peranan pemohon dan pelulus yang jelas", "Bajet bulanan untuk setiap cawangan", "Ruang kerja syarikat yang selamat dan terasing"], footer: "Operasi Axora · Pengurusan perolehan selamat", back: "Laman web Axora" },
} as const;

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; setup?: string; reset?: string }> }) {
  const user = await getAccountLifecycleSession();
  if (user) {
    const profile = await getMyProfile(user);
    redirect(myProfileMeetsRequiredOnboarding(profile)
      ? landingPathForSession(user)
      : "/profile?onboarding=1");
  }
  const { error, setup, reset } = await searchParams;
  const demo = isDemoMode();
  const { locale } = await requestLocaleDecision();
  const copy = pageCopy[locale];
  return (
    <main className="login-shell" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <section className="login-story">
        <div className="login-brand"><Brand /></div>
        <div>
          <span className="pilot-chip"><Boxes size={15} /> {copy.chip}</span>
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
          <ul className="feature-list">
            {copy.points.map((point) => <li key={point}><CheckCircle2 /> {point}</li>)}
          </ul>
        </div>
        <small>{copy.footer}</small>
      </section>
      <section className="login-panel">
        <div className="login-panel-stack"><Link className="login-back-link" href={`/${locale}`}><ArrowLeft className="directional-icon" size={17} aria-hidden="true" />{copy.back}</Link><LoginForm
            error={Boolean(error)}
            setupComplete={setup === "complete"}
            resetComplete={reset === "complete"}
            demo={demo}
            demoEmail={process.env.DEMO_EMAIL}
            demoPassword={process.env.DEMO_PASSWORD}
            locale={locale}
          /></div>
      </section>
    </main>
  );
}

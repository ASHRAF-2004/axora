import { LoginForm } from "@/components/LoginForm";
import styles from "@/components/LoginForm.module.css";
import { getAccountLifecycleSession } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import { requestLocaleDecision } from "@/lib/locale-server";
import {
  getMyProfile,
  myProfileMeetsRequiredOnboarding,
} from "@/lib/profile";
import { landingPathForSession } from "@/lib/session-landing";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false, noarchive: true },
};

const backLabels = {
  en: "Back to website",
  ar: "العودة إلى الموقع",
  ms: "Kembali ke laman web",
} as const;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    setup?: string;
    reset?: string;
  }>;
}) {
  const user = await getAccountLifecycleSession();

  if (user) {
    const profile = await getMyProfile(user);
    redirect(
      myProfileMeetsRequiredOnboarding(profile)
        ? landingPathForSession(user)
        : "/profile?onboarding=1",
    );
  }

  const { error, setup, reset } = await searchParams;
  const demo = isDemoMode();
  const { locale } = await requestLocaleDecision();
  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;

  return (
    <main
      className={styles.page}
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      aria-label="Axora login"
    >
      <Link
        className={styles.backLink}
        href={`/${locale}`}
        aria-label={backLabels[locale]}
      >
        <BackIcon size={18} aria-hidden="true" />
        <span>{backLabels[locale]}</span>
      </Link>

      <div className={styles.container}>
        <LoginForm
          error={Boolean(error)}
          setupComplete={setup === "complete"}
          resetComplete={reset === "complete"}
          demo={demo}
          demoEmail={process.env.DEMO_EMAIL}
          demoPassword={process.env.DEMO_PASSWORD}
          locale={locale}
        />
      </div>
    </main>
  );
}

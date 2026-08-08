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
import {
  authorizedSessionReturnPath,
  safeInternalReturnPath,
  type SessionReturnReason,
} from "@/lib/session-return";
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

const returnReasons = new Set<SessionReturnReason>([
  "required",
  "expired",
  "access-changed",
]);

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    setup?: string;
    reset?: string;
    returnTo?: string;
    reason?: string;
  }>;
}) {
  const params = await searchParams;
  const user = await getAccountLifecycleSession();

  if (user) {
    const profile = await getMyProfile(user);
    const landing = landingPathForSession(user);
    const destination = authorizedSessionReturnPath(
      user,
      params.returnTo,
      landing,
    );
    if (!myProfileMeetsRequiredOnboarding(profile)) {
      const profileParams = new URLSearchParams({
        onboarding: "1",
        returnTo: safeInternalReturnPath(destination, landing),
      });
      redirect(`/profile?${profileParams.toString()}`);
    }
    redirect(destination);
  }

  const demo = isDemoMode();
  const { locale } = await requestLocaleDecision();
  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;
  const reason = returnReasons.has(params.reason as SessionReturnReason)
    ? params.reason as SessionReturnReason
    : undefined;

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
          error={Boolean(params.error)}
          setupComplete={params.setup === "complete"}
          resetComplete={params.reset === "complete"}
          demo={demo}
          demoEmail={process.env.DEMO_EMAIL}
          demoPassword={process.env.DEMO_PASSWORD}
          returnTo={params.returnTo}
          reason={reason}
          locale={locale}
        />
      </div>
    </main>
  );
}

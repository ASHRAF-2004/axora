import { LoginForm } from "@/components/LoginForm";
import { getAccountLifecycleSession } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { landingPathForSession } from "@/lib/session-landing";
import { requestLocaleDecision } from "@/lib/locale-server";
import { getMyProfile, myProfileMeetsRequiredOnboarding } from "@/lib/profile";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; setup?: string; reset?: string }>;
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

  return (
    <main
      className="login-template-shell"
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <LoginForm
        error={Boolean(error)}
        setupComplete={setup === "complete"}
        resetComplete={reset === "complete"}
        demo={demo}
        demoEmail={process.env.DEMO_EMAIL}
        demoPassword={process.env.DEMO_PASSWORD}
        locale={locale}
      />
    </main>
  );
}

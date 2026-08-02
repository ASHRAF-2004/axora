"use server";

import { authenticate, setSession } from "@/lib/auth";
import { getMyProfile, myProfileMeetsRequiredOnboarding } from "@/lib/profile";
import { landingPathForSession } from "@/lib/session-landing";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

function loginNetworkIdentifier(requestHeaders: Headers) {
  const candidate = requestHeaders.get("cf-connecting-ip")?.trim()
    || requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  return candidate && candidate.length <= 128
    && !/[\u0000-\u001F\u007F]/.test(candidate)
    ? candidate
    : undefined;
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const requestHeaders = await headers();
  const user = await authenticate(email, password, {
    networkIdentifier: loginNetworkIdentifier(requestHeaders),
  });
  if (!user) redirect("/login?error=1");
  await setSession(user);
  const profile = await getMyProfile(user);
  (await cookies()).set(LOCALE_COOKIE, profile.preferredLocale, {
    path: "/",
    maxAge: 31_536_000,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  if (!myProfileMeetsRequiredOnboarding(profile)) redirect("/profile?onboarding=1");
  redirect(landingPathForSession(user));
}

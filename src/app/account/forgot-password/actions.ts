"use server";

import { requestPasswordReset } from "@/lib/security-notifications";
import { headers } from "next/headers";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isSupportedLocale, LOCALE_COOKIE } from "@/lib/i18n";

function requestNetworkIdentifier(requestHeaders: Headers) {
  const candidate = requestHeaders.get("cf-connecting-ip")?.trim()
    || requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "network-unavailable";
  return candidate.length <= 128 && !/[\u0000-\u001F\u007F]/.test(candidate)
    ? candidate
    : "network-unavailable";
}

/** Always returns the same public destination, including for unknown users. */
export async function requestPasswordResetAction(formData: FormData) {
  const requestHeaders = await headers();
  const requestedLocale = String(formData.get("locale") ?? "en");
  const locale = isSupportedLocale(requestedLocale) ? requestedLocale : "en";
  try {
    await requestPasswordReset(
      String(formData.get("email") ?? ""),
      requestNetworkIdentifier(requestHeaders),
      locale,
    );
  } catch {
    // The public response intentionally cannot reveal account existence,
    // throttling, provider configuration, or a temporary backend error.
  }
  (await cookies()).set(LOCALE_COOKIE, locale, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
  redirect(`/account/forgot-password?requested=1&locale=${locale}`);
}

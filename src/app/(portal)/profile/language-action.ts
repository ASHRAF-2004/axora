"use server";

import { requireAccountLifecycleSession } from "@/lib/auth";
import { isSupportedLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { updateMyPreferredLocale } from "@/lib/profile";
import { cookies } from "next/headers";

export async function setPreferredLocaleAction(locale: string) {
  if (!isSupportedLocale(locale)) throw new Error("Choose a supported language.");
  const actor = await requireAccountLifecycleSession();
  await updateMyPreferredLocale(locale, actor);
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 31_536_000,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

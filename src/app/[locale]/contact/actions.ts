"use server";

import { isSupportedLocale } from "@/lib/i18n";
import { submitPublicContact } from "@/lib/public-contact";
import { verifyTurnstileContact } from "@/lib/turnstile";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function submitContactAction(locale: string, formData: FormData) {
  if (!isSupportedLocale(locale)) redirect("/en/contact?status=failure");
  // A hidden field absorbs unsophisticated bots without confirming rejection.
  if (String(formData.get("website") ?? "").trim()) redirect(`/${locale}/contact?status=success`);
  const requestHeaders = await headers();
  const remoteIp = requestHeaders.get("cf-connecting-ip")?.trim()
    || "network-unavailable";
  let accepted = false;
  try {
    if (formData.get("privacyAccepted") !== "on") throw new Error("Privacy confirmation is required.");
    const verified = await verifyTurnstileContact({
      token: String(formData.get("cf-turnstile-response") ?? ""),
      remoteIp: remoteIp === "network-unavailable" ? undefined : remoteIp,
    });
    await submitPublicContact({
      locale,
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      company: String(formData.get("company") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      subject: String(formData.get("subject") ?? ""),
      message: String(formData.get("message") ?? ""),
      privacyAccepted: true,
    }, verified, remoteIp);
    accepted = true;
  } catch {
    accepted = false;
  }
  redirect(`/${locale}/contact?status=${accepted ? "success" : "failure"}`);
}

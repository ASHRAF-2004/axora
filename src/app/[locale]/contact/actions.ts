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
      idempotencyToken: String(formData.get("idempotencyToken") ?? ""),
      contactName: String(formData.get("contactName") ?? ""),
      companyName: String(formData.get("companyName") ?? ""),
      companyLegalName: String(formData.get("companyName") ?? ""),
      city: "Not provided",
      industry: "Not provided",
      employeeRange: "1_10",
      branchRange: "1",
      spendRange: "UNDISCLOSED",
      contactMethod: "EMAIL",
      contactTimezone: "Asia/Kuala_Lumpur",
      subject: String(formData.get("subject") ?? ""),
      message: String(formData.get("message") ?? ""),
      campaign: {
        source: String(formData.get("utmSource") ?? ""),
        medium: String(formData.get("utmMedium") ?? ""),
        campaign: String(formData.get("utmCampaign") ?? ""),
        term: String(formData.get("utmTerm") ?? ""),
        content: String(formData.get("utmContent") ?? ""),
      },
      privacyAccepted: true,
    }, verified, remoteIp);
    accepted = true;
  } catch {
    accepted = false;
  }
  redirect(`/${locale}/contact?status=${accepted ? "success" : "failure"}`);
}

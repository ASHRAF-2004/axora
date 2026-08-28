"use server";

import { isSupportedLocale } from "@/lib/i18n";
import {
  ContactVerificationError,
  submitPublicContact,
} from "@/lib/public-contact";
import { PublicRequestRateLimitError } from "@/lib/transactional-email";
import {
  TurnstileVerificationError,
  verifyTurnstileContact,
} from "@/lib/turnstile";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";

class ContactFormValidationError extends Error {}

function contactFailureCategory(error: unknown) {
  if (error instanceof TurnstileVerificationError
    || error instanceof ContactVerificationError) return "turnstile";
  if (error instanceof PublicRequestRateLimitError) return "rate_limit";
  if (error instanceof ContactFormValidationError
    || error instanceof ZodError) return "validation";
  return "persistence";
}

export async function submitContactAction(locale: string, formData: FormData) {
  if (!isSupportedLocale(locale)) redirect("/en/contact?status=failure");
  // A hidden field absorbs unsophisticated bots without confirming rejection.
  if (String(formData.get("website") ?? "").trim()) redirect(`/${locale}/contact?status=success`);
  const requestHeaders = await headers();
  const remoteIp = requestHeaders.get("cf-connecting-ip")?.trim()
    || "network-unavailable";
  const diagnosticId = randomUUID();
  let accepted = false;
  try {
    if (formData.get("privacyAccepted") !== "on") {
      throw new ContactFormValidationError("Privacy confirmation is required.");
    }
    const verified = await verifyTurnstileContact({
      token: String(formData.get("cf-turnstile-response") ?? ""),
      remoteIp: remoteIp === "network-unavailable" ? undefined : remoteIp,
    });
    await submitPublicContact({
      locale,
      idempotencyToken: String(formData.get("idempotencyToken") ?? ""),
      fullName: String(formData.get("fullName") ?? ""),
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? ""),
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
  } catch (error) {
    const sqlState = typeof error === "object" && error
      && "code" in error && typeof error.code === "string"
      && /^[0-9A-Z]{5}$/.test(error.code)
      ? error.code
      : undefined;
    console.error(JSON.stringify({
      event: "public_contact_submission_failed",
      diagnosticId,
      category: contactFailureCategory(error),
      locale,
      ...(error instanceof TurnstileVerificationError
        ? { turnstileReason: error.reason }
        : {}),
      ...(sqlState ? { sqlState } : {}),
    }));
    accepted = false;
  }
  redirect(`/${locale}/contact?status=${accepted ? "success" : "failure"}`);
}

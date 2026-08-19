import { createHash } from "node:crypto";

/**
 * Provider-neutral recipient fingerprint used by the Resend event adapter and
 * PostgreSQL suppression boundary. Raw recipient addresses are never persisted
 * in provider-event evidence.
 */
export function emailRecipientFingerprint(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 254
    || /[^\x20-\x7e]/.test(normalized)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("The email recipient is invalid.");
  }
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function emailProviderEventsEnabled() {
  return process.env.AXORA_EMAIL_EVENTS_ENABLED === "true";
}

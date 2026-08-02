import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { isDemoMode, withAuditTransaction } from "./db";

const WEBHOOK_PATH = "/api/email/provider-events/cloudflare";
const WEBHOOK_SECRET_MINIMUM_LENGTH = 32;
const WEBHOOK_CLOCK_SKEW_SECONDS = 90;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export type CloudflareEmailProviderEvent = {
  schemaVersion: 1;
  eventId: string;
  eventType:
    | "MESSAGE_DELIVERED"
    | "MESSAGE_DEFERRED"
    | "MESSAGE_BOUNCED"
    | "MESSAGE_FAILED"
    | "MESSAGE_REJECTED"
    | "MESSAGE_COMPLAINED";
  recipientFingerprint: string;
  messageFingerprint: string;
  terminal: boolean;
  bounceType?: "HARD" | "SOFT";
  occurredAt: string;
};

export type RecordedCloudflareEmailProviderEvent = {
  recorded: boolean;
  suppressed: boolean;
};

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderSource, name: string) {
  if (headers instanceof Headers) return headers.get(name) ?? "";
  const matchingKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  const value = matchingKey ? headers[matchingKey] : undefined;
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function webhookSecret() {
  const filename = process.env.AXORA_EMAIL_EVENTS_WEBHOOK_SECRET_FILE;
  let value = "";
  if (filename) {
    try {
      value = readFileSync(filename, "utf8").trim();
    } catch {
      throw new Error("The email event webhook secret is unavailable.");
    }
  } else if (process.env.NODE_ENV !== "production") {
    value = (process.env.AXORA_EMAIL_EVENTS_WEBHOOK_SECRET ?? "").trim();
  }
  if (value.length < WEBHOOK_SECRET_MINIMUM_LENGTH
    || value.length > 4_096 || /[\s\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("The email event webhook secret is unavailable.");
  }
  return value;
}

function canonicalWebhookRequest(
  method: string,
  pathname: string,
  body: string,
  timestamp: string,
) {
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  return [timestamp, method.toUpperCase(), pathname, bodyHash].join("\n");
}

/** Test/setup helper. The production Worker implements the same Web Crypto contract. */
export function signEmailProviderEventRequest(
  method: string,
  pathname: string,
  body: string,
  options: { now?: number } = {},
) {
  if (method.toUpperCase() !== "POST" || pathname !== WEBHOOK_PATH) {
    throw new Error("The email event webhook target is invalid.");
  }
  const timestamp = String(Math.floor((options.now ?? Date.now()) / 1_000));
  const signature = createHmac("sha256", webhookSecret())
    .update(canonicalWebhookRequest(method, pathname, body, timestamp), "utf8")
    .digest("base64url");
  return {
    "X-Axora-Email-Event-Timestamp": timestamp,
    "X-Axora-Email-Event-Signature": signature,
  };
}

export function verifyEmailProviderEventRequest(input: {
  method: string;
  pathname: string;
  body: string;
  headers: HeaderSource;
  now?: number;
}) {
  try {
    if (input.method.toUpperCase() !== "POST" || input.pathname !== WEBHOOK_PATH) {
      return false;
    }
    const timestamp = headerValue(
      input.headers,
      "x-axora-email-event-timestamp",
    );
    const signature = headerValue(
      input.headers,
      "x-axora-email-event-signature",
    );
    if (!/^\d{10,13}$/.test(timestamp)) return false;
    const timestampSeconds = Number(timestamp);
    const nowSeconds = Math.floor((input.now ?? Date.now()) / 1_000);
    if (!Number.isSafeInteger(timestampSeconds)
      || Math.abs(nowSeconds - timestampSeconds) > WEBHOOK_CLOCK_SKEW_SECONDS
      || !SIGNATURE_PATTERN.test(signature)) {
      return false;
    }
    const expected = createHmac("sha256", webhookSecret())
      .update(canonicalWebhookRequest(
        input.method,
        input.pathname,
        input.body,
        timestamp,
      ), "utf8")
      .digest();
    const supplied = Buffer.from(signature, "base64url");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}

export function emailRecipientFingerprint(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 254
    || /[^\x20-\x7e]/.test(normalized)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("The email recipient is invalid.");
  }
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function validateProviderEvent(
  event: CloudflareEmailProviderEvent,
): CloudflareEmailProviderEvent {
  const occurredAt = new Date(event.occurredAt);
  const eventTypeIsTerminal = event.eventType !== "MESSAGE_DEFERRED";
  if (event.schemaVersion !== 1
    || ![
      "MESSAGE_DELIVERED",
      "MESSAGE_DEFERRED",
      "MESSAGE_BOUNCED",
      "MESSAGE_FAILED",
      "MESSAGE_REJECTED",
      "MESSAGE_COMPLAINED",
    ].includes(event.eventType)
    || !UUID_PATTERN.test(event.eventId)
    || !FINGERPRINT_PATTERN.test(event.recipientFingerprint)
    || !FINGERPRINT_PATTERN.test(event.messageFingerprint)
    || event.terminal !== eventTypeIsTerminal
    || !RFC3339_UTC_PATTERN.test(event.occurredAt)
    || Number.isNaN(occurredAt.getTime())
    || occurredAt.getTime() > Date.now() + 10 * 60 * 1_000
    || (event.eventType === "MESSAGE_BOUNCED"
      && !["HARD", "SOFT"].includes(event.bounceType ?? ""))
    || (event.eventType !== "MESSAGE_BOUNCED"
      && event.bounceType !== undefined)) {
    throw new Error("The email provider event is invalid.");
  }
  return event;
}

export function emailProviderEventsEnabled() {
  return process.env.AXORA_EMAIL_EVENTS_ENABLED === "true";
}

export async function recordCloudflareEmailProviderEvent(
  input: CloudflareEmailProviderEvent,
): Promise<RecordedCloudflareEmailProviderEvent> {
  if (isDemoMode()) throw new Error("Email provider events are unavailable.");
  const event = validateProviderEvent(input);
  return withAuditTransaction(
    { reason: `Cloudflare email event ${event.eventId}` },
    async (client) => {
      const result = await client.query<RecordedCloudflareEmailProviderEvent>(`
        SELECT recorded,suppressed
        FROM axora_record_cloudflare_email_event($1,$2,$3,$4,$5,$6,$7,$8)
      `, [
        event.eventId,
        event.eventType,
        event.recipientFingerprint,
        event.messageFingerprint,
        event.bounceType ?? null,
        event.terminal,
        event.occurredAt,
        event.schemaVersion,
      ]);
      const row = result.rows[0];
      if (!row || typeof row.recorded !== "boolean"
        || typeof row.suppressed !== "boolean") {
        throw new Error("The email provider event was not recorded.");
      }
      return row;
    },
  );
}

export const emailProviderEventInternals = {
  canonicalWebhookRequest,
  validateProviderEvent,
  webhookPath: WEBHOOK_PATH,
};

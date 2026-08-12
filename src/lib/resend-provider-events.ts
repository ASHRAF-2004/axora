import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { Webhook } from "svix";
import { isDemoMode, withAuditTransaction } from "./db";
import { emailRecipientFingerprint } from "./email-provider-events";

const WEBHOOK_PATH = "/api/email/provider-events/resend";
const MAX_EVENT_BYTES = 16 * 1024;
const SECRET_MINIMUM_LENGTH = 24;
const SUPPORTED_EVENTS = new Set([
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.delivery_delayed",
  "email.failed",
  "email.suppressed",
]);

type HeaderSource = Headers | Record<string, string | string[] | undefined>;
type ResendLifecycleEventType =
  | "MESSAGE_SUBMITTED"
  | "MESSAGE_DELIVERED"
  | "MESSAGE_DEFERRED"
  | "MESSAGE_BOUNCED"
  | "MESSAGE_FAILED"
  | "MESSAGE_COMPLAINED"
  | "MESSAGE_SUPPRESSED";
export type NormalizedResendEvent = {
  schemaVersion: 1;
  eventId: string;
  eventType: ResendLifecycleEventType;
  recipientFingerprint: string;
  messageFingerprint: string;
  terminal: boolean;
  bounceType?: "HARD" | "SOFT";
  occurredAt: string;
};

function boundedString(value: unknown, maximum = 255) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/.test(normalized)) return undefined;
  return normalized;
}

function headerValue(headers: HeaderSource, name: string) {
  if (headers instanceof Headers) return headers.get(name) ?? "";
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function webhookSecret(env = process.env) {
  const filename = String(env.RESEND_WEBHOOK_SECRET_FILE ?? "").trim();
  let value = "";
  if (filename) {
    try {
      value = readFileSync(filename, "utf8").trim();
    } catch {
      throw new Error("The Resend webhook secret is unavailable.");
    }
  } else if (env.NODE_ENV !== "production") {
    value = String(env.RESEND_WEBHOOK_SECRET ?? "").trim();
  }
  if (value.length < SECRET_MINIMUM_LENGTH || value.length > 4_096
    || /[\s\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("The Resend webhook secret is unavailable.");
  }
  return value;
}

function providerUuid(value: string) {
  const bytes = createHash("sha256").update(`resend:${value}`, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function verifiedHeaders(headers: HeaderSource) {
  const id = boundedString(headerValue(headers, "svix-id"), 255);
  const timestamp = boundedString(headerValue(headers, "svix-timestamp"), 32);
  const signature = boundedString(headerValue(headers, "svix-signature"), 1_024);
  if (!id || !timestamp || !signature) return undefined;
  return { id, timestamp, signature };
}

export function verifyResendWebhookRequest(input: {
  method: string;
  pathname: string;
  rawBody: string;
  headers: HeaderSource;
  env?: NodeJS.ProcessEnv;
}) {
  try {
    if (input.method.toUpperCase() !== "POST" || input.pathname !== WEBHOOK_PATH
      || !input.rawBody || Buffer.byteLength(input.rawBody, "utf8") > MAX_EVENT_BYTES) {
      return undefined;
    }
    const headers = verifiedHeaders(input.headers);
    if (!headers) return undefined;
    const payload = new Webhook(webhookSecret(input.env)).verify(input.rawBody, {
      "svix-id": headers.id,
      "svix-timestamp": headers.timestamp,
      "svix-signature": headers.signature,
    });
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
    return { payload: payload as Record<string, unknown>, eventIdentity: headers.id };
  } catch {
    return undefined;
  }
}

export function isSupportedResendEvent(payload: Record<string, unknown>) {
  return typeof payload.type === "string" && SUPPORTED_EVENTS.has(payload.type);
}

function eventTime(value: unknown) {
  const timestamp = boundedString(value, 64);
  if (!timestamp) throw new Error("The Resend webhook timestamp is invalid.");
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) throw new Error("The Resend webhook timestamp is invalid.");
  return parsed.toISOString();
}

function normalizedRecipient(value: unknown) {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("The Resend webhook recipient is invalid.");
  }
  const address = boundedString(value[0], 254)?.toLowerCase();
  if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new Error("The Resend webhook recipient is invalid.");
  }
  return address;
}

export function normalizeResendWebhookEvent(
  payload: Record<string, unknown>,
  eventIdentity: string,
): NormalizedResendEvent {
  const type = boundedString(payload.type, 80);
  const data = payload.data;
  if (!type || !SUPPORTED_EVENTS.has(type)
    || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The Resend webhook payload is invalid.");
  }
  const record = data as Record<string, unknown>;
  const providerMessageId = boundedString(record.email_id, 255);
  if (!providerMessageId) throw new Error("The Resend email identity is invalid.");

  let eventType: ResendLifecycleEventType;
  let terminal = true;
  let bounceType: "HARD" | "SOFT" | undefined;
  if (type === "email.sent") {
    eventType = "MESSAGE_SUBMITTED";
    terminal = false;
  } else if (type === "email.delivered") {
    eventType = "MESSAGE_DELIVERED";
  } else if (type === "email.delivery_delayed") {
    eventType = "MESSAGE_DEFERRED";
    terminal = false;
  } else if (type === "email.bounced") {
    eventType = "MESSAGE_BOUNCED";
    const bounce = record.bounce;
    if (!bounce || typeof bounce !== "object" || Array.isArray(bounce)) {
      throw new Error("The Resend bounce is invalid.");
    }
    const bounceCategory = boundedString((bounce as Record<string, unknown>).type, 32)?.toLowerCase();
    if (bounceCategory === "permanent") bounceType = "HARD";
    else if (bounceCategory === "temporary") bounceType = "SOFT";
    else throw new Error("The Resend bounce is invalid.");
  } else if (type === "email.complained") {
    eventType = "MESSAGE_COMPLAINED";
  } else if (type === "email.failed") {
    eventType = "MESSAGE_FAILED";
  } else {
    eventType = "MESSAGE_SUPPRESSED";
  }
  const normalized: NormalizedResendEvent = {
    schemaVersion: 1,
    eventId: providerUuid(eventIdentity),
    eventType,
    recipientFingerprint: emailRecipientFingerprint(normalizedRecipient(record.to)),
    messageFingerprint: createHash("sha256").update(providerMessageId, "utf8").digest("hex"),
    terminal,
    occurredAt: eventTime(payload.created_at ?? record.created_at),
  };
  return bounceType ? { ...normalized, bounceType } : normalized;
}

export async function recordResendProviderEvent(event: NormalizedResendEvent) {
  if (isDemoMode()) throw new Error("Email provider events are unavailable.");
  return withAuditTransaction(
    { reason: `Resend email event ${event.eventId}` },
    async (client) => {
      const result = await client.query<{ recorded: boolean; suppressed: boolean }>(`
        SELECT recorded,suppressed FROM axora_record_resend_email_event(
          $1,$2,$3,$4,$5,$6,$7,$8
        )
      `, [event.eventId,event.eventType,event.recipientFingerprint,
        event.messageFingerprint,event.bounceType ?? null,event.terminal,
        event.occurredAt,event.schemaVersion]);
      const row = result.rows[0];
      if (!row || typeof row.recorded !== "boolean" || typeof row.suppressed !== "boolean") {
        throw new Error("The Resend event was not recorded.");
      }
      return row;
    },
  );
}

export function signResendWebhookForTest(
  rawBody: string,
  secret: string,
  id: string,
  timestamp = Math.floor(Date.now() / 1_000),
) {
  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const key = Buffer.from(encodedSecret, "base64");
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`, "utf8").digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": `v1,${signature}`,
  };
}

export const resendProviderEventInternals = {
  providerUuid,
  webhookPath: WEBHOOK_PATH,
};

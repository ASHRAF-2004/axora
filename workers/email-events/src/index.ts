const PROVIDER_DELIVERED = "cf.email.sending.message.delivered";
const PROVIDER_DEFERRED = "cf.email.sending.message.deferred";
const PROVIDER_BOUNCED = "cf.email.sending.message.bounced";
const PROVIDER_FAILED = "cf.email.sending.message.failed";
const PROVIDER_REJECTED = "cf.email.sending.message.rejected";
const PROVIDER_COMPLAINED = "cf.email.sending.message.complained";
const ENDPOINT_PATH = "/api/email/provider-events/cloudflare";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const RETRY_DELAY_SECONDS = 60;

type JsonObject = Record<string, unknown>;

export type SanitizedEmailProviderEvent = {
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

type QueueMessageControl = Pick<Message<unknown>, "body" | "ack" | "retry">;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerEventId(value: unknown) {
  if (!isObject(value) || !isObject(value.payload)) return "unavailable";
  const eventId = value.payload.eventId;
  return typeof eventId === "string" && UUID_PATTERN.test(eventId)
    ? eventId.toLowerCase()
    : "unavailable";
}

function normalizeRecipient(value: unknown) {
  if (typeof value !== "string") throw new Error("invalid_recipient");
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 254
    || /[^\x20-\x7e]/.test(normalized)
    || !EMAIL_PATTERN.test(normalized)) {
    throw new Error("invalid_recipient");
  }
  return normalized;
}

function expectedSendingDomain(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 253
    || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(normalized)
    || normalized.includes("..")
    || (normalized !== "axora.management"
      && !normalized.endsWith(".axora.management"))) {
    throw new Error("invalid_domain_configuration");
  }
  return normalized;
}

function senderMatchesDomain(value: unknown, domain: string) {
  const sender = normalizeRecipient(value);
  return sender.slice(sender.lastIndexOf("@") + 1) === domain;
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => (
    byte.toString(16).padStart(2, "0")
  )).join("");
}

function base64Url(bytes: ArrayBuffer) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function recipientFingerprint(recipient: string) {
  return hex(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(recipient.trim().toLowerCase()),
  ));
}

export async function providerMessageFingerprint(value: unknown) {
  if (typeof value !== "string" || !/^[\x20-\x7e]{1,512}$/.test(value)) {
    throw new Error("invalid_message_id");
  }
  return hex(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ));
}

function boundedProviderText(value: unknown) {
  return typeof value === "string" && value.trim().length >= 1 && value.length <= 1_024
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export async function sanitizeProviderEvent(
  value: unknown,
  expectedDomain: string,
): Promise<SanitizedEmailProviderEvent> {
  const domain = expectedSendingDomain(expectedDomain);
  if (!isObject(value) || !isObject(value.source)
    || !isObject(value.payload) || !isObject(value.metadata)
    || value.source.type !== "email.sending"
    || typeof value.source.domain !== "string"
    || value.source.domain.toLowerCase() !== domain
    || value.metadata.eventSchemaVersion !== 1
    || typeof value.metadata.eventTimestamp !== "string"
    || !RFC3339_UTC_PATTERN.test(value.metadata.eventTimestamp)
    || Number.isNaN(new Date(value.metadata.eventTimestamp).getTime())
    || typeof value.payload.eventId !== "string"
    || !UUID_PATTERN.test(value.payload.eventId)
    || typeof value.payload.terminal !== "boolean"
    || !isObject(value.payload.delivery)
    || !senderMatchesDomain(value.payload.sender, domain)) {
    throw new Error("invalid_provider_event");
  }

  const recipient = normalizeRecipient(value.payload.recipient);
  const common = {
    schemaVersion: 1 as const,
    eventId: value.payload.eventId.toLowerCase(),
    recipientFingerprint: await recipientFingerprint(recipient),
    messageFingerprint: await providerMessageFingerprint(value.payload.messageId),
    terminal: value.payload.terminal,
    occurredAt: value.metadata.eventTimestamp,
  };
  if (value.type === PROVIDER_DELIVERED
    && value.payload.terminal === true
    && value.payload.delivery.status === "delivered") {
    return { ...common, eventType: "MESSAGE_DELIVERED" };
  }
  if (value.type === PROVIDER_DEFERRED
    && value.payload.terminal === false
    && value.payload.delivery.status === "deferred"
    && isObject(value.payload.bounce)
    && value.payload.bounce.type === "soft") {
    return { ...common, eventType: "MESSAGE_DEFERRED" };
  }
  if (value.type === PROVIDER_COMPLAINED
    && value.payload.delivery.status === "complained"
    && value.payload.terminal === true
    && isObject(value.payload.complaint)
    && boundedProviderText(value.payload.complaint.type)) {
    return { ...common, eventType: "MESSAGE_COMPLAINED" };
  }
  if (value.type === PROVIDER_BOUNCED && isObject(value.payload.bounce)
    && value.payload.terminal === true
    && value.payload.delivery.status === "bounced"
    && ["hard", "soft"].includes(String(value.payload.bounce.type))) {
    return {
      ...common,
      eventType: "MESSAGE_BOUNCED",
      bounceType: value.payload.bounce.type === "hard" ? "HARD" : "SOFT",
    };
  }
  if (value.type === PROVIDER_FAILED
    && value.payload.terminal === true
    && value.payload.delivery.status === "failed"
    && isObject(value.payload.failure)
    && boundedProviderText(value.payload.failure.reason)) {
    return { ...common, eventType: "MESSAGE_FAILED" };
  }
  if (value.type === PROVIDER_REJECTED
    && value.payload.terminal === true
    && value.payload.delivery.status === "rejected"
    && isObject(value.payload.rejection)
    && boundedProviderText(value.payload.rejection.reason)
    && boundedProviderText(value.payload.rejection.party)) {
    return { ...common, eventType: "MESSAGE_REJECTED" };
  }
  throw new Error("unsupported_provider_event");
}

function endpointUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "axora.management"
    || url.port || url.username || url.password || url.pathname !== ENDPOINT_PATH
    || url.search || url.hash) {
    throw new Error("invalid_endpoint_configuration");
  }
  return url;
}

function webhookSecret(value: string) {
  if (value.length < 32 || value.length > 4_096
    || /[\s\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("invalid_secret_configuration");
  }
  return value;
}

async function sha256Hex(value: string) {
  return hex(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ));
}

export async function signEventBody(
  body: string,
  pathname: string,
  timestamp: string,
  secret: string,
) {
  const canonical = [timestamp, "POST", pathname, await sha256Hex(body)].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(canonical),
  ));
}

async function postSanitizedEvent(event: SanitizedEmailProviderEvent, env: Env) {
  const url = endpointUrl(env.AXORA_EMAIL_EVENTS_ENDPOINT_URL);
  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = await signEventBody(
    body,
    url.pathname,
    timestamp,
    env.AXORA_EMAIL_EVENTS_WEBHOOK_SECRET,
  );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Axora-Email-Event-Timestamp": timestamp,
      "X-Axora-Email-Event-Signature": signature,
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const accepted = response.ok;
  if (response.body) await response.body.cancel();
  if (!accepted) throw new Error("endpoint_rejected_event");
}

function logResult(event: string, eventId: string, outcome: string) {
  console.log(JSON.stringify({ event, eventId, outcome }));
}

async function processMessage(message: QueueMessageControl, env: Env) {
  const eventId = providerEventId(message.body);
  let event: SanitizedEmailProviderEvent;
  try {
    event = await sanitizeProviderEvent(
      message.body,
      env.AXORA_EMAIL_EVENTS_EXPECTED_DOMAIN,
    );
  } catch {
    logResult("email_provider_event", eventId, "discarded_invalid");
    message.ack();
    return;
  }

  try {
    await postSanitizedEvent(event, env);
    logResult("email_provider_event", event.eventId, "forwarded");
    message.ack();
  } catch {
    logResult("email_provider_event", event.eventId, "retry_scheduled");
    message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
  }
}

export default {
  async queue(batch, env): Promise<void> {
    await Promise.all(batch.messages.map((message) => processMessage(message, env)));
  },
} satisfies ExportedHandler<Env, unknown>;

export const emailEventWorkerInternals = {
  endpointUrl,
  postSanitizedEvent,
  processMessage,
  providerEventId,
};

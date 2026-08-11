import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDemoMode, withAuditTransaction } from "./db";
import { emailRecipientFingerprint } from "./email-provider-events";

const WEBHOOK_PATH = "/api/email/provider-events/zeptomail";
const MAX_EVENT_BYTES = 16 * 1024;
const WEBHOOK_WINDOW_MS = 5 * 60 * 1_000;
const SECRET_MINIMUM_LENGTH = 32;
const PROVIDER_AGENT_ENV_KEY = "ZEPTOMAIL_MAIL_AGENT_KEY";
const PROVIDER_AGENT_KEY_MAXIMUM_LENGTH = 200;
const PROVIDER_AGENT_KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const LEGACY_AGENT_ENV_KEYS = [
  "ZEPTOMAIL_AUTH_AGENT_KEY",
  "ZEPTOMAIL_PROCUREMENT_AGENT_KEY",
  "ZEPTOMAIL_BUDGET_AGENT_KEY",
  "ZEPTOMAIL_DELIVERY_AGENT_KEY",
  "ZEPTOMAIL_DOCUMENTS_AGENT_KEY",
  "ZEPTOMAIL_PLATFORM_AGENT_KEY",
] as const;

type HeaderSource = Headers | Record<string, string | string[] | undefined>;
type ZeptoMailWebhookEnvelope = {
  eventName: string;
  eventMessage: Record<string, unknown>;
  eventData: Record<string, unknown>;
  details: Record<string, unknown>;
  emailInfo: Record<string, unknown>;
  mailAgentKey: string;
  webhookRequestId: string;
  requestId: string;
};
type NormalizedEvent = {
  schemaVersion: 1;
  eventId: string;
  eventType: "MESSAGE_DELIVERED" | "MESSAGE_BOUNCED" | "MESSAGE_COMPLAINED";
  recipientFingerprint: string;
  messageFingerprint: string;
  terminal: true;
  bounceType?: "HARD" | "SOFT";
  occurredAt: string;
};

function headerValue(headers: HeaderSource, name: string) {
  if (headers instanceof Headers) return headers.get(name) ?? "";
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function boundedString(value: unknown, maximum = 255) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

export function isZeptoMailProviderAgentKey(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= PROVIDER_AGENT_KEY_MAXIMUM_LENGTH
    && PROVIDER_AGENT_KEY_PATTERN.test(value);
}

function singleString(value: unknown, maximum: number) {
  const item = Array.isArray(value)
    ? value.length === 1 ? value[0] : undefined
    : value;
  return boundedString(item, maximum);
}

function singleObject(value: unknown, optional = false): Record<string, unknown> {
  if ((value === undefined || value === null) && optional) return {};
  const item = Array.isArray(value)
    ? value.length === 1 ? value[0] : undefined
    : value;
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error("The ZeptoMail webhook payload is invalid.");
  }
  return item as Record<string, unknown>;
}

function validateRecipientShape(emailInfo: Record<string, unknown>) {
  const recipients = emailInfo.to;
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 100
    || recipients.some((recipient) => {
      if (!recipient || typeof recipient !== "object" || Array.isArray(recipient)) return true;
      const address = (recipient as Record<string, unknown>).email_address;
      return address !== undefined
        && (!address || typeof address !== "object" || Array.isArray(address));
    })) {
    throw new Error("The ZeptoMail webhook recipient is invalid.");
  }
}

export function normalizeZeptoMailWebhookEnvelope(
  event: Record<string, unknown>,
): ZeptoMailWebhookEnvelope {
  const eventName = singleString(event.event_name, 80)
    ?.toLowerCase().replaceAll(/[^a-z]/g, "");
  const eventMessage = singleObject(event.event_message);
  const emailInfo = singleObject(eventMessage.email_info);
  const eventData = singleObject(eventMessage.event_data, true);
  const details = singleObject(eventData.details, true);
  const mailAgentKey = event.mailagent_key;
  const webhookRequestId = boundedString(event.webhook_request_id, 255);
  const requestId = boundedString(eventMessage.request_id ?? event.request_id, 255);
  if (!eventName || !isZeptoMailProviderAgentKey(mailAgentKey)
    || !webhookRequestId || !requestId) {
    throw new Error("The ZeptoMail webhook identity is invalid.");
  }
  validateRecipientShape(emailInfo);
  return {
    eventName,
    eventMessage,
    eventData,
    details,
    emailInfo,
    mailAgentKey,
    webhookRequestId,
    requestId,
  };
}

function providerUuid(value: string) {
  const bytes = createHash("sha256").update(`zeptomail:${value}`, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function configuredAgentKeys(env = process.env) {
  const providerAgent = String(env[PROVIDER_AGENT_ENV_KEY] ?? "");
  const values = providerAgent
    ? [providerAgent]
    : LEGACY_AGENT_ENV_KEYS.map((key) => String(env[key] ?? "")).filter(Boolean);
  const uniqueValues = [...new Set(values)];
  if (!uniqueValues.length
    || uniqueValues.some((value) => !isZeptoMailProviderAgentKey(value))) {
    throw new Error("The ZeptoMail Agent identity configuration is unavailable.");
  }
  return new Set(uniqueValues);
}

export function zeptoMailWebhookBootstrapState(
  env: NodeJS.ProcessEnv = process.env,
): "disabled" | "enabled" | "invalid" {
  if (env.ZEPTOMAIL_WEBHOOK_BOOTSTRAP_ENABLED !== "true") return "disabled";
  return env.AXORA_EMAIL_PROVIDER === "zeptomail"
    && env.AXORA_EMAIL_DELIVERY_ENABLED === "false"
    && env.AXORA_EMAIL_EVENTS_ENABLED === "false"
    ? "enabled" : "invalid";
}

export function verifyZeptoMailWebhookBootstrapEvent(
  event: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
) {
  try {
    if (zeptoMailWebhookBootstrapState(env) !== "enabled") return false;
    const normalized = normalizeZeptoMailWebhookEnvelope(event);
    return Boolean(
      ["delivered", "softbounce", "softbounced", "hardbounce", "hardbounced",
        "feedbackloop", "feedback"].includes(normalized.eventName)
      && configuredAgentKeys(env).has(normalized.mailAgentKey),
    );
  } catch {
    return false;
  }
}

function webhookSecret(env = process.env) {
  const filename = String(env.ZEPTOMAIL_WEBHOOK_AUTH_KEY_FILE
    ?? env.AXORA_EMAIL_EVENTS_WEBHOOK_SECRET_FILE ?? "").trim();
  let value = "";
  if (filename) {
    try {
      value = readFileSync(filename, "utf8").trim();
    } catch {
      throw new Error("The ZeptoMail webhook key is unavailable.");
    }
  } else if (env.NODE_ENV !== "production") {
    value = String(env.ZEPTOMAIL_WEBHOOK_AUTH_KEY ?? "").trim();
  }
  if (value.length < SECRET_MINIMUM_LENGTH || value.length > 4_096
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("The ZeptoMail webhook key is unavailable.");
  }
  return value;
}

export function parseZeptoMailWebhookForm(rawBody: string) {
  if (!rawBody || Buffer.byteLength(rawBody, "utf8") > MAX_EVENT_BYTES) {
    throw new Error("The ZeptoMail webhook body is invalid.");
  }
  const fields = new URLSearchParams(rawBody);
  if ([...fields.keys()].some((key) => key !== "event") || fields.getAll("event").length !== 1) {
    throw new Error("The ZeptoMail webhook form is invalid.");
  }
  const eventRaw = fields.get("event") ?? "";
  if (!eventRaw || Buffer.byteLength(eventRaw, "utf8") > MAX_EVENT_BYTES) {
    throw new Error("The ZeptoMail webhook event is invalid.");
  }
  let event: unknown;
  try {
    event = JSON.parse(eventRaw);
  } catch {
    throw new Error("The ZeptoMail webhook event is invalid.");
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("The ZeptoMail webhook event is invalid.");
  }
  return { eventRaw, event: event as Record<string, unknown> };
}

export function parseZeptoMailWebhookPayload(rawBody: string, mediaType: string) {
  if (mediaType === "application/x-www-form-urlencoded") {
    return parseZeptoMailWebhookForm(rawBody);
  }
  if (mediaType !== "application/json" || !rawBody
    || Buffer.byteLength(rawBody, "utf8") > MAX_EVENT_BYTES) {
    throw new Error("The ZeptoMail webhook body is invalid.");
  }
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new Error("The ZeptoMail webhook event is invalid.");
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("The ZeptoMail webhook event is invalid.");
  }
  return { eventRaw: rawBody, event: event as Record<string, unknown> };
}

function signatureParts(value: string) {
  const entries = value.split(";").map((part) => part.split("=", 2));
  if (entries.length !== 3 || entries.some(([key, item]) => !key || item === undefined)) return undefined;
  const parts = Object.fromEntries(entries);
  if (Object.keys(parts).length !== 3 || parts["s-algorithm"] !== "HmacSHA256"
    || !/^\d{13}$/.test(parts.ts ?? "")) return undefined;
  let signature: Buffer;
  try {
    signature = Buffer.from(decodeURIComponent(parts.s ?? ""), "base64");
  } catch {
    return undefined;
  }
  return signature.length === 32 ? { timestamp: Number(parts.ts), signature } : undefined;
}

export function verifyZeptoMailWebhookRequest(input: {
  method: string;
  pathname: string;
  eventRaw: string;
  event: Record<string, unknown>;
  headers: HeaderSource;
  now?: number;
  env?: NodeJS.ProcessEnv;
}) {
  try {
    if (input.method.toUpperCase() !== "POST" || input.pathname !== WEBHOOK_PATH) return false;
    const normalized = normalizeZeptoMailWebhookEnvelope(input.event);
    if (!configuredAgentKeys(input.env).has(normalized.mailAgentKey)) return false;
    const parts = signatureParts(headerValue(input.headers, "producer-signature"));
    const now = input.now ?? Date.now();
    if (!parts || !Number.isSafeInteger(parts.timestamp)
      || Math.abs(now - parts.timestamp) > WEBHOOK_WINDOW_MS) return false;
    const expected = createHmac("sha256", webhookSecret(input.env))
      .update(input.eventRaw, "utf8").digest();
    return timingSafeEqual(parts.signature, expected);
  } catch {
    return false;
  }
}

function eventTime(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
    return new Date(milliseconds).toISOString();
  }
  if (typeof value === "string" && value.length <= 64) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(fallback).toISOString();
}

function recipientAddress(emailInfo: Record<string, unknown>) {
  const recipients = Array.isArray(emailInfo.to) ? emailInfo.to : [];
  if (recipients.length !== 1 || !recipients[0] || typeof recipients[0] !== "object") {
    throw new Error("The ZeptoMail webhook recipient is invalid.");
  }
  const item = recipients[0] as Record<string, unknown>;
  const nested = item.email_address && typeof item.email_address === "object"
    ? item.email_address as Record<string, unknown> : item;
  const address = boundedString(nested.address, 254);
  if (!address) throw new Error("The ZeptoMail webhook recipient is invalid.");
  return address;
}

export function normalizeZeptoMailWebhookEvent(
  event: Record<string, unknown>,
  options: { signatureTimestamp?: number } = {},
): NormalizedEvent {
  const normalizedEnvelope = normalizeZeptoMailWebhookEnvelope(event);
  const {
    eventName,
    emailInfo,
    details,
    requestId,
    webhookRequestId,
  } = normalizedEnvelope;

  let eventType: NormalizedEvent["eventType"];
  let bounceType: "HARD" | "SOFT" | undefined;
  if (eventName === "delivered") eventType = "MESSAGE_DELIVERED";
  else if (eventName === "softbounce" || eventName === "softbounced") {
    eventType = "MESSAGE_BOUNCED";
    bounceType = "SOFT";
  } else if (eventName === "hardbounce" || eventName === "hardbounced") {
    eventType = "MESSAGE_BOUNCED";
    bounceType = "HARD";
  } else if (eventName === "feedbackloop" || eventName === "feedback") {
    eventType = "MESSAGE_COMPLAINED";
  } else {
    throw new Error("The ZeptoMail webhook event type is unsupported.");
  }
  const occurredAt = eventTime(
    details.time ?? details.modified_time ?? emailInfo.processed_time,
    options.signatureTimestamp ?? Date.now(),
  );
  const normalized: NormalizedEvent = {
    schemaVersion: 1,
    eventId: providerUuid(`${webhookRequestId}:${eventName}`),
    eventType,
    recipientFingerprint: emailRecipientFingerprint(recipientAddress(emailInfo)),
    messageFingerprint: createHash("sha256").update(requestId, "utf8").digest("hex"),
    terminal: true,
    occurredAt,
  };
  return bounceType ? { ...normalized, bounceType } : normalized;
}

export async function recordZeptoMailProviderEvent(event: NormalizedEvent) {
  if (isDemoMode()) throw new Error("Email provider events are unavailable.");
  return withAuditTransaction(
    { reason: `ZeptoMail email event ${event.eventId}` },
    async (client) => {
      const result = await client.query<{ recorded: boolean; suppressed: boolean }>(`
        SELECT recorded,suppressed FROM axora_record_zeptomail_email_event(
          $1,$2,$3,$4,$5,$6,$7,$8
        )
      `, [event.eventId,event.eventType,event.recipientFingerprint,
        event.messageFingerprint,event.bounceType ?? null,event.terminal,
        event.occurredAt,event.schemaVersion]);
      const row = result.rows[0];
      if (!row || typeof row.recorded !== "boolean" || typeof row.suppressed !== "boolean") {
        throw new Error("The ZeptoMail event was not recorded.");
      }
      return row;
    },
  );
}

export function signZeptoMailWebhookEventForTest(
  eventRaw: string,
  secret: string,
  timestamp = Date.now(),
) {
  const signature = createHmac("sha256", secret).update(eventRaw, "utf8").digest("base64");
  return `ts=${timestamp};s=${encodeURIComponent(signature)};s-algorithm=HmacSHA256`;
}

export const zeptoMailProviderEventInternals = {
  providerUuid,
  webhookPath: WEBHOOK_PATH,
  configuredAgentKeys,
};

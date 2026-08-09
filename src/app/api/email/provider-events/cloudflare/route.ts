import {
  emailProviderEventsEnabled,
  recordCloudflareEmailProviderEvent,
  verifyEmailProviderEventRequest,
} from "@/lib/email-provider-events";
import { recordEmailWebhookProcessingFailure } from "@/lib/email-operations";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024;
const commonFields = {
  schemaVersion: z.literal(1),
  eventId: z.uuid(),
  recipientFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  messageFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  occurredAt: z.string().trim().min(20).max(40).refine(
    (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
      && !Number.isNaN(new Date(value).getTime()),
    "Invalid event timestamp",
  ),
};
const eventSchema = z.discriminatedUnion("eventType", [
  z.object({
    ...commonFields,
    eventType: z.literal("MESSAGE_DELIVERED"),
    terminal: z.literal(true),
  }).strict(),
  z.object({
    ...commonFields,
    eventType: z.literal("MESSAGE_DEFERRED"),
    terminal: z.literal(false),
  }).strict(),
  z.object({
    ...commonFields,
    eventType: z.literal("MESSAGE_BOUNCED"),
    terminal: z.literal(true),
    bounceType: z.enum(["HARD", "SOFT"]),
  }).strict(),
  z.object({
    ...commonFields,
    eventType: z.literal("MESSAGE_FAILED"),
    terminal: z.literal(true),
  }).strict(),
  z.object({
    ...commonFields,
    eventType: z.literal("MESSAGE_REJECTED"),
    terminal: z.literal(true),
  }).strict(),
  z.object({
    ...commonFields,
    eventType: z.literal("MESSAGE_COMPLAINED"),
    terminal: z.literal(true),
  }).strict(),
]);

function noStoreJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  if (!emailProviderEventsEnabled()) {
    return noStoreJson({ error: "service_unavailable" }, 503);
  }
  const mediaType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return noStoreJson({ error: "unsupported_media_type" }, 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY_BYTES) {
      return noStoreJson({ error: "request_too_large" }, 413);
    }
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return noStoreJson({ error: "request_too_large" }, 413);
  }
  const pathname = new URL(request.url).pathname;
  if (!verifyEmailProviderEventRequest({
    method: request.method,
    pathname,
    body: rawBody,
    headers: request.headers,
  })) {
    return noStoreJson({ error: "unauthorized" }, 401);
  }

  let event: z.infer<typeof eventSchema>;
  try {
    event = eventSchema.parse(JSON.parse(rawBody));
  } catch {
    await recordEmailWebhookProcessingFailure(
      "cloudflare-email-service",
      "invalid_payload",
    ).catch(() => undefined);
    return noStoreJson({ error: "invalid_request" }, 400);
  }

  try {
    const result = await recordCloudflareEmailProviderEvent(event);
    // A duplicate provider event is a successful idempotent replay. Returning
    // 2xx lets the Queue acknowledge it without changing suppression counts.
    return noStoreJson({ accepted: true, ...result });
  } catch {
    await recordEmailWebhookProcessingFailure(
      "cloudflare-email-service",
      "processing_failed",
    ).catch(() => undefined);
    return noStoreJson({ error: "service_unavailable" }, 503);
  }
}

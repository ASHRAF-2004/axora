import { emailProviderEventsEnabled } from "@/lib/email-provider-events";
import { recordEmailWebhookProcessingFailure } from "@/lib/email-operations";
import {
  normalizeZeptoMailWebhookEvent,
  parseZeptoMailWebhookPayload,
  recordZeptoMailProviderEvent,
  verifyZeptoMailWebhookBootstrapEvent,
  verifyZeptoMailWebhookRequest,
  zeptoMailWebhookBootstrapState,
} from "@/lib/zeptomail-provider-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

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
  const eventsEnabled = emailProviderEventsEnabled();
  const bootstrapState = zeptoMailWebhookBootstrapState();
  if (bootstrapState === "invalid" || (!eventsEnabled && bootstrapState !== "enabled")) {
    return noStoreJson({ error: "service_unavailable" }, 503);
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json" && mediaType !== "application/x-www-form-urlencoded") {
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
  let parsed: ReturnType<typeof parseZeptoMailWebhookPayload>;
  try {
    parsed = parseZeptoMailWebhookPayload(rawBody, mediaType);
  } catch {
    return noStoreJson({ error: "invalid_request" }, 400);
  }
  if (bootstrapState === "enabled") {
    if (!verifyZeptoMailWebhookBootstrapEvent(parsed.event)) {
      return noStoreJson({ error: "unauthorized" }, 401);
    }
    return noStoreJson({ accepted: false, bootstrap: true });
  }
  const pathname = new URL(request.url).pathname;
  if (!verifyZeptoMailWebhookRequest({
    method: request.method,
    pathname,
    eventRaw: parsed.eventRaw,
    event: parsed.event,
    headers: request.headers,
  })) {
    return noStoreJson({ error: "unauthorized" }, 401);
  }
  try {
    const event = normalizeZeptoMailWebhookEvent(parsed.event);
    const result = await recordZeptoMailProviderEvent(event);
    return noStoreJson({ accepted: true, ...result });
  } catch {
    await recordEmailWebhookProcessingFailure(
      "zeptomail",
      "processing_failed",
    ).catch(() => undefined);
    return noStoreJson({ error: "service_unavailable" }, 503);
  }
}

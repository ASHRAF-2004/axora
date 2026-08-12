import { emailProviderEventsEnabled } from "@/lib/email-provider-events";
import { recordEmailWebhookProcessingFailure } from "@/lib/email-operations";
import {
  isSupportedResendEvent,
  normalizeResendWebhookEvent,
  recordResendProviderEvent,
  verifyResendWebhookRequest,
} from "@/lib/resend-provider-events";

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
  if (!emailProviderEventsEnabled() || process.env.AXORA_EMAIL_PROVIDER !== "resend") {
    return noStoreJson({ error: "service_unavailable" }, 503);
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
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
  const verified = verifyResendWebhookRequest({
    method: request.method,
    pathname: new URL(request.url).pathname,
    rawBody,
    headers: request.headers,
  });
  if (!verified) return noStoreJson({ error: "unauthorized" }, 401);
  if (!isSupportedResendEvent(verified.payload)) {
    return noStoreJson({ accepted: true, ignored: true });
  }
  let event;
  try {
    event = normalizeResendWebhookEvent(verified.payload, verified.eventIdentity);
  } catch {
    await recordEmailWebhookProcessingFailure("resend", "invalid_payload")
      .catch(() => undefined);
    return noStoreJson({ error: "invalid_request" }, 400);
  }
  try {
    const result = await recordResendProviderEvent(event);
    return noStoreJson({ accepted: true, ...result });
  } catch {
    await recordEmailWebhookProcessingFailure("resend", "processing_failed")
      .catch(() => undefined);
    return noStoreJson({ error: "service_unavailable" }, 503);
  }
}

import { emailProviderEventsEnabled } from "@/lib/email-provider-events";
import { recordEmailWebhookProcessingFailure } from "@/lib/email-operations";
import {
  inspectZeptoMailWebhookBootstrapEvent,
  normalizeZeptoMailWebhookEvent,
  parseZeptoMailWebhookPayload,
  recordZeptoMailProviderEvent,
  verifyZeptoMailWebhookRequest,
  zeptoMailWebhookBootstrapState,
  type ZeptoMailWebhookValidationStage,
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

function logBootstrapValidation(input: {
  stage: ZeptoMailWebhookValidationStage | "transport_media_type" | "body_size" | "json_parse";
  agentMatched: boolean | null;
  mediaType: string;
  bodyBytes: number | null;
}) {
  console.info(JSON.stringify({
    event: "zeptomail_webhook_bootstrap_validation",
    stage: input.stage,
    agentMatch: input.agentMatched === null
      ? "UNKNOWN"
      : input.agentMatched ? "MATCH" : "DOES_NOT_MATCH",
    mediaType: input.mediaType,
    bodyBytes: input.bodyBytes,
  }));
}

export async function POST(request: Request) {
  const eventsEnabled = emailProviderEventsEnabled();
  const bootstrapState = zeptoMailWebhookBootstrapState();
  if (bootstrapState === "invalid" || (!eventsEnabled && bootstrapState !== "enabled")) {
    return noStoreJson({ error: "service_unavailable" }, 503);
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json" && mediaType !== "application/x-www-form-urlencoded") {
    if (bootstrapState === "enabled") {
      logBootstrapValidation({
        stage: "transport_media_type",
        agentMatched: null,
        mediaType: mediaType ?? "missing",
        bodyBytes: null,
      });
    }
    return noStoreJson({ error: "unsupported_media_type" }, 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY_BYTES) {
      if (bootstrapState === "enabled") {
        logBootstrapValidation({
          stage: "body_size",
          agentMatched: null,
          mediaType,
          bodyBytes: Number.isSafeInteger(length) && length >= 0 ? length : null,
        });
      }
      return noStoreJson({ error: "request_too_large" }, 413);
    }
  }
  const rawBody = await request.text();
  const bodyBytes = Buffer.byteLength(rawBody, "utf8");
  if (bodyBytes > MAX_BODY_BYTES) {
    if (bootstrapState === "enabled") {
      logBootstrapValidation({
        stage: "body_size",
        agentMatched: null,
        mediaType,
        bodyBytes,
      });
    }
    return noStoreJson({ error: "request_too_large" }, 413);
  }
  let parsed: ReturnType<typeof parseZeptoMailWebhookPayload>;
  try {
    parsed = parseZeptoMailWebhookPayload(rawBody, mediaType);
  } catch {
    if (bootstrapState === "enabled") {
      logBootstrapValidation({
        stage: "json_parse",
        agentMatched: null,
        mediaType,
        bodyBytes,
      });
    }
    return noStoreJson({ error: "invalid_request" }, 400);
  }
  if (bootstrapState === "enabled") {
    const inspection = inspectZeptoMailWebhookBootstrapEvent(parsed.event);
    logBootstrapValidation({
      stage: inspection.stage,
      agentMatched: inspection.agentMatched,
      mediaType,
      bodyBytes,
    });
    if (!inspection.accepted) {
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

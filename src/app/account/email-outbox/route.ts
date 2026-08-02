import { verifyEmailServiceRequest } from "@/lib/account-email";
import {
  claimTransactionalEmailOutbox,
  completeTransactionalEmailOutbox,
} from "@/lib/transactional-email";
import {
  claimWorkflowEmailOutbox,
  completeWorkflowEmailOutbox,
} from "@/lib/workflow-email";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INTERNAL_BODY_BYTES = 8 * 1024;
const transactionalClaimSchema = z.object({
  action: z.literal("claim"),
  queue: z.literal("transactional"),
}).strict();
const workflowClaimSchema = z.object({
  action: z.literal("claim"),
  queue: z.literal("workflow"),
}).strict();
const transactionalCompleteSchema = z.object({
  action: z.literal("complete"),
  queue: z.literal("transactional"),
  deliveryId: z.uuid(),
  leaseId: z.uuid(),
  outcome: z.enum(["sent", "retry", "failed", "disabled", "uncertain"]),
  providerMessageId: z.string().trim().min(1).max(255).regex(/^[^\r\n]+$/).optional(),
  errorCode: z.string().trim().regex(/^[a-z0-9_]{1,64}$/).optional(),
}).strict();
const workflowCompleteSchema = z.object({
  action: z.literal("complete"),
  queue: z.literal("workflow"),
  deliveryId: z.uuid(),
  leaseId: z.uuid(),
  outcome: z.enum(["sent", "retry", "failed", "disabled", "uncertain"]),
  providerMessageId: z.string().trim().min(1).max(255).regex(/^[^\r\n]+$/).optional(),
  errorCode: z.string().trim().regex(/^[a-z0-9_]{1,64}$/).optional(),
}).strict();
const requestSchema = z.union([
  transactionalClaimSchema,
  workflowClaimSchema,
  transactionalCompleteSchema,
  workflowCompleteSchema,
]);

function noStoreJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return noStoreJson({ error: "unsupported_media_type" }, 415);
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_INTERNAL_BODY_BYTES) {
    return noStoreJson({ error: "request_too_large" }, 413);
  }
  const pathname = new URL(request.url).pathname;
  if (!verifyEmailServiceRequest({
    method: request.method,
    pathname,
    body: rawBody,
    headers: request.headers,
  })) {
    return noStoreJson({ error: "unauthorized" }, 401);
  }

  let parsed: z.infer<typeof requestSchema>;
  try {
    parsed = requestSchema.parse(JSON.parse(rawBody));
  } catch {
    return noStoreJson({ error: "invalid_request" }, 400);
  }

  try {
    if (parsed.action === "claim") {
      if (parsed.queue === "workflow") {
        const job = await claimWorkflowEmailOutbox();
        return noStoreJson({ job });
      }
      if (parsed.queue === "transactional") {
        const job = await claimTransactionalEmailOutbox();
        return noStoreJson({ job });
      }
    }

    if (parsed.queue === "workflow") {
      const recorded = await completeWorkflowEmailOutbox(
        parsed.deliveryId,
        parsed.leaseId,
        parsed.outcome,
        {
          providerMessageId: parsed.providerMessageId,
          errorCode: parsed.errorCode,
        },
      );
      return recorded
        ? noStoreJson({ recorded: true })
        : noStoreJson({ error: "stale_lease" }, 409);
    }

    if (parsed.queue === "transactional") {
      const recorded = await completeTransactionalEmailOutbox(
        parsed.deliveryId,
        parsed.leaseId,
        parsed.outcome,
        {
          providerMessageId: parsed.providerMessageId,
          errorCode: parsed.errorCode,
        },
      );
      return recorded
        ? noStoreJson({ recorded: true })
        : noStoreJson({ error: "stale_lease" }, 409);
    }

    return noStoreJson({ error: "invalid_request" }, 400);
  } catch {
    // Never echo or log a queue body; security jobs contain bearer links.
    return noStoreJson({ error: "service_unavailable" }, 503);
  }
}

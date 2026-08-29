import { ExternalApiProblem, handleExternalApiRequest } from "@/lib/integrations/api-handler";
import { integrationNetworkHash } from "@/lib/integrations/network";
import { readLimitedTextBody } from "@/lib/integrations/request";
import { createExternalRequestDraft, parseExternalDraft } from "@/lib/integrations/resources";

export const dynamic = "force-dynamic";

async function parseJsonBody(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ExternalApiProblem("invalid_request",400,"INVALID","body","request_draft");
  }
  const raw = await readLimitedTextBody(request,65_536);
  if (raw === null) {
    throw new ExternalApiProblem("invalid_request",400,"INVALID","body","request_draft");
  }
  try {
    return parseExternalDraft(JSON.parse(raw));
  } catch (error) {
    if (error instanceof ExternalApiProblem) throw error;
    throw new ExternalApiProblem("invalid_request",400,"INVALID","body","request_draft");
  }
}

export async function POST(request: Request) {
  return handleExternalApiRequest(request, {
    scope: "requests:draft",action: "REQUEST_DRAFT_CREATE",
    routeClass: "API_WRITE",resourceType: "request_draft",
  }, async (principal,requestId) => {
    if (new URL(request.url).search) throw new ExternalApiProblem(
      "invalid_request",400,"INVALID","query","request_draft",
    );
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    const payload = await parseJsonBody(request);
    const result = await createExternalRequestDraft({
      principal,payload,idempotencyKey,requestId,
      networkHash: integrationNetworkHash(request),
    });
    const data = result.data as { id?: string };
    return {
      data: result.data,status: 201,
      meta: { idempotency_replayed: result.replayed },
      resourceType: "request_draft",resourceId: data.id,
      auditRecorded: !result.replayed,
    };
  });
}

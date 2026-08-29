import { ExternalApiProblem, handleExternalApiRequest } from "@/lib/integrations/api-handler";
import { parseExternalPagination } from "@/lib/integrations/pagination";
import { listExternalRequests } from "@/lib/integrations/resources";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleExternalApiRequest(request, {
    scope: "requests:read",action: "REQUEST_LIST",resourceType: "request",
  }, async (principal) => {
    const pagination = parseExternalPagination(request,"/api/v1/requests",principal.companyId);
    if (!pagination.ok) throw new ExternalApiProblem(
      "invalid_request",400,"INVALID",pagination.field,"request",
    );
    const result = await listExternalRequests({
      principal,limit: pagination.limit,cursor: pagination.cursor,
    });
    return {
      data: result.data,
      meta: { pagination: {
        limit: pagination.limit,has_more: result.hasMore,next_cursor: result.nextCursor,
      } },
      resourceType: "request",
    };
  });
}

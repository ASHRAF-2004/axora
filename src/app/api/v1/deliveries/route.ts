import { ExternalApiProblem, handleExternalApiRequest } from "@/lib/integrations/api-handler";
import { parseExternalPagination } from "@/lib/integrations/pagination";
import { listExternalDeliveries } from "@/lib/integrations/resources";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleExternalApiRequest(request, {
    scope: "deliveries:read",action: "DELIVERY_LIST",resourceType: "delivery",
  }, async (principal) => {
    const pagination = parseExternalPagination(request,"/api/v1/deliveries",principal.companyId);
    if (!pagination.ok) throw new ExternalApiProblem(
      "invalid_request",400,"INVALID",pagination.field,"delivery",
    );
    const result = await listExternalDeliveries({
      principal,limit: pagination.limit,cursor: pagination.cursor,
    });
    return {
      data: result.data,
      meta: { pagination: {
        limit: pagination.limit,has_more: result.hasMore,next_cursor: result.nextCursor,
      } },
      resourceType: "delivery",
    };
  });
}

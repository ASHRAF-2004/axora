import { ExternalApiProblem, handleExternalApiRequest } from "@/lib/integrations/api-handler";
import { parseExternalPagination } from "@/lib/integrations/pagination";
import { listExternalCompanies } from "@/lib/integrations/resources";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleExternalApiRequest(request, {
    scope: "companies:read",action: "COMPANY_LIST",resourceType: "company",
  }, async (principal) => {
    const pagination = parseExternalPagination(
      request,"/api/v1/companies",principal.companyId,
    );
    if (!pagination.ok) throw new ExternalApiProblem(
      "invalid_request",400,"INVALID",pagination.field,"company",
    );
    const companies = pagination.cursor ? [] : await listExternalCompanies(principal);
    return {
      data: companies.slice(0,pagination.limit),
      meta: { pagination: { limit: pagination.limit,has_more: false,next_cursor: null } },
      resourceType: "company",
    };
  });
}
